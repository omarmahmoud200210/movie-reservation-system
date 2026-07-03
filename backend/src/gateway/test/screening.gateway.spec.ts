import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import type { Socket, Server } from 'socket.io';
import { ScreeningGateway } from '../screening.gateway';
import { ScreeningsService } from '../../screenings/screenings.service';

const mockScreeningsService = {
  getSeatMap: jest.fn(),
  getScreeningSummary: jest.fn(),
};

function mockClient(): jest.Mocked<Pick<Socket, 'join'>> {
  return { join: jest.fn() };
}

describe('ScreeningGateway', () => {
  let gateway: ScreeningGateway;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScreeningGateway,
        { provide: ScreeningsService, useValue: mockScreeningsService },
      ],
    }).compile();

    gateway = module.get<ScreeningGateway>(ScreeningGateway);
  });

  describe('handleConnection', () => {
    it('accepts every connection (no auth this phase)', () => {
      const client = mockClient() as unknown as Socket;
      expect(() => gateway.handleConnection(client)).not.toThrow();
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
