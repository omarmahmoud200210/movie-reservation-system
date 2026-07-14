import { NotFoundException } from '@nestjs/common';
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
 * visitor watching a screening. No WS auth — the only mutating action
 * (reserve/cancel) is already guarded over HTTP; this gateway only pushes
 * state, it never accepts one.
 */
@WebSocketGateway({ cors: { origin: process.env.FRONTEND_URL } })
export class ScreeningGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly screeningsService: ScreeningsService,
    @InjectMetric('websocket_connections_current')
    private readonly connectionsGauge: Gauge<string>,
    @InjectMetric('websocket_room_joins_total')
    private readonly joinsCounter: Counter<string>,
  ) {}

  handleConnection(client: Socket): void {
    // DEFERRED(phase-7): attach holder identity here (verify the httpOnly
    // access_token cookie via JwtService) once per-holder hold-expiry
    // notifications need to target a specific socket. Requires re-enabling
    // `credentials: true` in the gateway's CORS options above.
    void client;
    this.connectionsGauge.inc();
  }

  handleDisconnect(client: Socket): void {
    void client;
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

  // DEFERRED(phase-7): subscribe to the Redis Pub/Sub `seat:hold_expired`
  // channel here (published by the phase-6 cron job) and call emitToRoom to
  // broadcast it, plus a direct emit to the holder's socket (see the
  // handleConnection marker above for where that identity gets attached).

  emitToRoom(screeningId: number, event: string, payload: unknown): void {
    this.server.to(roomName(screeningId)).emit(event, payload);
  }
}
