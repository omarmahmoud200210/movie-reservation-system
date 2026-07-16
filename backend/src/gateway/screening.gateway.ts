import { NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter, Gauge } from 'prom-client';
// Note: @ConnectedSocket()/@MessageBody() only resolve inside @SubscribeMessage
// handlers (Nest's RPC argument pipeline). handleConnection is invoked directly
// by the OnGatewayConnection lifecycle hook, so its parameter is undecorated.
import { type AccessPayload } from '../auth/token.service';
import {
  ScreeningsService,
  type ScreeningSummary,
  type SeatMapEntry,
} from '../screenings/screenings.service';

type JoinScreeningResult =
  | { ok: true; seats: SeatMapEntry[]; summary: ScreeningSummary }
  | { ok: false; error: string };

const roomName = (screeningId: number) => `screening:${screeningId}`;

/**
 * Public, read-only real-time layer: broadcasts seat/summary changes to every
 * visitor watching a screening. Connections optionally attach JWT identity for
 * per-holder hold-expiry notifications, but remain unauthenticated/public by
 * default — the only mutating action (reserve/cancel) is already guarded over
 * HTTP; this gateway only pushes state, it never accepts one.
 */
@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL, credentials: true },
})
export class ScreeningGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly userSockets = new Map<number, Set<Socket>>();

  constructor(
    private readonly screeningsService: ScreeningsService,
    private readonly jwtService: JwtService,
    @InjectMetric('websocket_connections_current')
    private readonly connectionsGauge: Gauge<string>,
    @InjectMetric('websocket_room_joins_total')
    private readonly joinsCounter: Counter<string>,
  ) {}

  private extractCookie(
    header: string | undefined,
    name: string,
  ): string | null {
    if (!header) return null;
    const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  handleConnection(client: Socket): void {
    const origin = client.handshake.headers.origin;
    const allowedOrigin = process.env.FRONTEND_URL;
    if (origin && allowedOrigin && origin !== allowedOrigin) {
      client.disconnect();
      return;
    }

    const cookieHeader = client.handshake.headers.cookie;
    const token = this.extractCookie(cookieHeader, 'access_token');
    if (token) {
      try {
        const payload = this.jwtService.verify<AccessPayload>(token, {
          secret: process.env.JWT_ACCESS_SECRET,
        });
        client.data.userId = payload.sub;
        const sockets = this.userSockets.get(payload.sub) ?? new Set<Socket>();
        sockets.add(client);
        this.userSockets.set(payload.sub, sockets);
      } catch {
        // Invalid/expired token: proceed as an anonymous connection, same as
        // having no cookie at all. This gateway never requires auth.
      }
    }
    this.connectionsGauge.inc();
  }

  handleDisconnect(client: Socket): void {
    const userId = client.data.userId as number | undefined;
    if (userId !== undefined) {
      const sockets = this.userSockets.get(userId);
      sockets?.delete(client);
      if (sockets && sockets.size === 0) this.userSockets.delete(userId);
    }
    this.connectionsGauge.dec();
  }

  @SubscribeMessage('join:screening')
  async handleJoin(
    @MessageBody() data: { screeningId: number },
    @ConnectedSocket() client: Socket,
  ): Promise<JoinScreeningResult> {
    const screeningId = Number(data?.screeningId);
    if (!Number.isInteger(screeningId) || screeningId < 1) {
      return { ok: false, error: 'Invalid screeningId' };
    }

    try {
      const seats = await this.screeningsService.getSeatMap(screeningId);
      const summary =
        await this.screeningsService.getScreeningSummary(screeningId);
      client.join(roomName(screeningId));
      this.joinsCounter.inc();
      return { ok: true, seats, summary };
    } catch (err) {
      if (err instanceof NotFoundException) {
        return { ok: false, error: err.message };
      }
      // Unexpected errors are intentionally not packed into the ack — only
      // expected client-facing failures (bad screening) get `{ ok: false }`.
      // This propagates to Nest's WS exception filter; the client relies on
      // Socket.io reconnect/retry rather than a bespoke error payload.
      throw err;
    }
  }

  emitToRoom(screeningId: number, event: string, payload: unknown): void {
    this.server.to(roomName(screeningId)).emit(event, payload);
  }

  emitToUser(userId: number, event: string, payload: unknown): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    for (const socket of sockets) socket.emit(event, payload);
  }
}
