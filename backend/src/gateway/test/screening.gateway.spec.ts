import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { NotFoundException } from '@nestjs/common';
import type { Socket, Server } from 'socket.io';
import { getToken } from '@willsoto/nestjs-prometheus';
import { ScreeningGateway } from '../screening.gateway';
import { ScreeningsService } from '../../screenings/screenings.service';

const mockScreeningsService = {
  getSeatMap: jest.fn(),
  getScreeningSummary: jest.fn(),
};

const mockJwtService = {
  verify: jest.fn(),
};

const mockConnectionsGauge = { inc: jest.fn(), dec: jest.fn() };
const mockJoinsCounter = { inc: jest.fn() };

function mockClient(cookieHeader?: string) {
  return {
    join: jest.fn(),
    emit: jest.fn(),
    handshake: { headers: { cookie: cookieHeader } },
    data: {} as { userId?: number },
  };
}

describe('ScreeningGateway', () => {
  let gateway: ScreeningGateway;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScreeningGateway,
        { provide: ScreeningsService, useValue: mockScreeningsService },
        { provide: JwtService, useValue: mockJwtService },
        {
          provide: getToken('websocket_connections_current'),
          useValue: mockConnectionsGauge,
        },
        {
          provide: getToken('websocket_room_joins_total'),
          useValue: mockJoinsCounter,
        },
      ],
    }).compile();

    gateway = module.get<ScreeningGateway>(ScreeningGateway);
  });

  describe('handleConnection', () => {
    it('accepts every connection (auth optional)', () => {
      const client = mockClient() as unknown as Socket;
      expect(() => gateway.handleConnection(client)).not.toThrow();
    });

    it('increments the connections gauge', () => {
      const client = mockClient() as unknown as Socket;
      gateway.handleConnection(client);
      expect(mockConnectionsGauge.inc).toHaveBeenCalledTimes(1);
    });

    it('does not throw and stays anonymous when there is no cookie', () => {
      const client = mockClient() as unknown as Socket;
      expect(() => gateway.handleConnection(client)).not.toThrow();
      expect(mockJwtService.verify).not.toHaveBeenCalled();
      expect(
        (client as unknown as { data: { userId?: number } }).data.userId,
      ).toBeUndefined();
    });

    it('does not throw and stays anonymous when the token is invalid/expired', () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      const client = mockClient('access_token=bad-token') as unknown as Socket;

      expect(() => gateway.handleConnection(client)).not.toThrow();
      expect(
        (client as unknown as { data: { userId?: number } }).data.userId,
      ).toBeUndefined();
    });

    it('attaches the holder identity from a valid access_token cookie', () => {
      mockJwtService.verify.mockReturnValue({ sub: 42 });
      const client = mockClient(
        'other=1; access_token=good-token; more=2',
      ) as unknown as Socket;

      gateway.handleConnection(client);

      expect(mockJwtService.verify).toHaveBeenCalledWith('good-token', {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      expect(
        (client as unknown as { data: { userId?: number } }).data.userId,
      ).toBe(42);
    });
  });

  describe('handleDisconnect', () => {
    it('decrements the connections gauge', () => {
      const client = mockClient() as unknown as Socket;
      gateway.handleDisconnect(client);
      expect(mockConnectionsGauge.dec).toHaveBeenCalledTimes(1);
    });

    it('does not throw for an anonymous (never-identified) client', () => {
      const client = mockClient() as unknown as Socket;
      expect(() => gateway.handleDisconnect(client)).not.toThrow();
    });
  });

  describe('emitToUser', () => {
    it('emits to every socket registered for that user, and none other', () => {
      mockJwtService.verify.mockReturnValue({ sub: 42 });
      const client1 = mockClient('access_token=t1') as unknown as Socket;
      const client2 = mockClient('access_token=t2') as unknown as Socket;
      gateway.handleConnection(client1);
      gateway.handleConnection(client2);

      const otherClient = mockClient() as unknown as Socket;
      gateway.handleConnection(otherClient);

      gateway.emitToUser(42, 'hold:expired', { screeningId: 1, seatId: 2 });

      expect(client1.emit).toHaveBeenCalledWith('hold:expired', {
        screeningId: 1,
        seatId: 2,
      });
      expect(client2.emit).toHaveBeenCalledWith('hold:expired', {
        screeningId: 1,
        seatId: 2,
      });
      expect(otherClient.emit).not.toHaveBeenCalled();
    });

    it('does nothing when no socket is registered for that user', () => {
      expect(() => gateway.emitToUser(999, 'hold:expired', {})).not.toThrow();
    });

    it('stops emitting to a socket after it disconnects', () => {
      mockJwtService.verify.mockReturnValue({ sub: 42 });
      const client = mockClient('access_token=t1') as unknown as Socket;
      gateway.handleConnection(client);
      gateway.handleDisconnect(client);

      gateway.emitToUser(42, 'hold:expired', {});

      expect(
        (client as unknown as { emit: jest.Mock }).emit,
      ).not.toHaveBeenCalled();
    });
  });

  describe('handleJoin', () => {
    it('joins the screening room and acks the seat map + summary', async () => {
      const seats = [{ seatId: 1, row: 'A', number: '1', status: 'AVAILABLE' }];
      const summary = {
        screeningId: 10,
        capacity: 1,
        held: 0,
        booked: 0,
        available: 1,
        reserved: 0,
      };
      mockScreeningsService.getSeatMap.mockResolvedValue(seats);
      mockScreeningsService.getScreeningSummary.mockResolvedValue(summary);
      const client = mockClient();

      const ack = await gateway.handleJoin(
        { screeningId: 10 },
        client as unknown as Socket,
      );

      expect(client.join).toHaveBeenCalledWith('screening:10');
      expect(ack).toEqual({ ok: true, seats, summary });
      expect(mockJoinsCounter.inc).toHaveBeenCalledTimes(1);
    });

    it('acks ok:false and does not join when the screening is unknown/cancelled', async () => {
      mockScreeningsService.getSeatMap.mockRejectedValue(
        new NotFoundException('Screening 99 not found'),
      );
      const client = mockClient();

      const ack = await gateway.handleJoin(
        { screeningId: 99 },
        client as unknown as Socket,
      );

      expect(ack).toEqual({ ok: false, error: 'Screening 99 not found' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('acks ok:false without calling the service for a malformed screeningId', async () => {
      const client = mockClient();

      const ack = await gateway.handleJoin(
        { screeningId: NaN },
        client as unknown as Socket,
      );

      expect(ack).toEqual({ ok: false, error: 'Invalid screeningId' });
      expect(mockScreeningsService.getSeatMap).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('rethrows unexpected (non-NotFound) errors', async () => {
      mockScreeningsService.getSeatMap.mockRejectedValue(new Error('DB down'));
      const client = mockClient();

      await expect(
        gateway.handleJoin({ screeningId: 10 }, client as unknown as Socket),
      ).rejects.toThrow('DB down');
    });
  });

  describe('emitToRoom', () => {
    it('emits the event to the screening room', () => {
      const mockServer = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
      gateway.server = mockServer as unknown as Server;

      gateway.emitToRoom(10, 'seat:reserved', { foo: 'bar' });

      expect(mockServer.to).toHaveBeenCalledWith('screening:10');
      expect(mockServer.emit).toHaveBeenCalledWith('seat:reserved', {
        foo: 'bar',
      });
    });
  });
});
