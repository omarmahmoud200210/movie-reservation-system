import { Test, TestingModule } from '@nestjs/testing';
import { SeatStatus } from '@prisma/client';
import { getToken } from '@willsoto/nestjs-prometheus';
import { ReservationBroadcastListener } from '../reservation-broadcast.listener';
import { ScreeningGateway } from '../screening.gateway';
import { ScreeningsService } from '../../screenings/screenings.service';

const mockGateway = { emitToRoom: jest.fn() };
const mockScreeningsService = { getScreeningSummary: jest.fn() };
const mockBroadcastsCounter = { inc: jest.fn() };

const summary = {
  screeningId: 10,
  capacity: 4,
  held: 1,
  booked: 0,
  available: 3,
  reserved: 1,
};

describe('ReservationBroadcastListener', () => {
  let listener: ReservationBroadcastListener;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockScreeningsService.getScreeningSummary.mockResolvedValue(summary);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationBroadcastListener,
        { provide: ScreeningGateway, useValue: mockGateway },
        { provide: ScreeningsService, useValue: mockScreeningsService },
        {
          provide: getToken('websocket_broadcasts_total'),
          useValue: mockBroadcastsCounter,
        },
      ],
    }).compile();

    listener = module.get<ReservationBroadcastListener>(
      ReservationBroadcastListener,
    );
  });

  describe('handleCreated', () => {
    it('broadcasts seat:reserved with HELD status and the screening summary', async () => {
      await listener.handleCreated({ screeningId: 10, seatIds: [1, 2] });

      expect(mockBroadcastsCounter.inc).toHaveBeenCalledWith({
        event: 'seat:reserved',
      });
      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(10, 'seat:reserved', {
        screeningId: 10,
        seatIds: [1, 2],
        status: SeatStatus.HELD,
      });
      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(
        10,
        'screening:summary',
        summary,
      );
    });

    it('still broadcasts the seat delta when the summary computation fails', async () => {
      mockScreeningsService.getScreeningSummary.mockRejectedValue(
        new Error('cache down'),
      );

      await expect(
        listener.handleCreated({ screeningId: 10, seatIds: [1] }),
      ).resolves.toBeUndefined();

      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(10, 'seat:reserved', {
        screeningId: 10,
        seatIds: [1],
        status: SeatStatus.HELD,
      });
      expect(mockGateway.emitToRoom).not.toHaveBeenCalledWith(
        10,
        'screening:summary',
        expect.anything(),
      );
    });

    it('swallows a failing emit instead of throwing, and still broadcasts the summary', async () => {
      mockGateway.emitToRoom.mockImplementationOnce(() => {
        throw new Error('socket error');
      });

      await expect(
        listener.handleCreated({ screeningId: 10, seatIds: [1] }),
      ).resolves.toBeUndefined();

      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(
        10,
        'screening:summary',
        summary,
      );
    });

    it('swallows failures in both the emit and the summary computation', async () => {
      mockGateway.emitToRoom.mockImplementationOnce(() => {
        throw new Error('socket error');
      });
      mockScreeningsService.getScreeningSummary.mockRejectedValue(
        new Error('cache down'),
      );

      await expect(
        listener.handleCreated({ screeningId: 10, seatIds: [1] }),
      ).resolves.toBeUndefined();
    });
  });

  describe('handleCancelled', () => {
    it('broadcasts seat:cancelled with AVAILABLE status and the screening summary', async () => {
      await listener.handleCancelled({ screeningId: 10, seatIds: [1] });

      expect(mockBroadcastsCounter.inc).toHaveBeenCalledWith({
        event: 'seat:cancelled',
      });
      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(
        10,
        'seat:cancelled',
        { screeningId: 10, seatIds: [1], status: SeatStatus.AVAILABLE },
      );
      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(
        10,
        'screening:summary',
        summary,
      );
    });
  });

  describe('handleConfirmed', () => {
    it('broadcasts seat:booked with BOOKED status and the screening summary', async () => {
      await listener.handleConfirmed({ screeningId: 10, seatIds: [11] });

      expect(mockBroadcastsCounter.inc).toHaveBeenCalledWith({
        event: 'seat:booked',
      });
      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(10, 'seat:booked', {
        screeningId: 10,
        seatIds: [11],
        status: SeatStatus.BOOKED,
      });
      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(
        10,
        'screening:summary',
        summary,
      );
    });

    it('still broadcasts the seat delta when the summary computation fails', async () => {
      mockScreeningsService.getScreeningSummary.mockRejectedValue(
        new Error('cache down'),
      );

      await expect(
        listener.handleConfirmed({ screeningId: 10, seatIds: [11] }),
      ).resolves.toBeUndefined();

      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(10, 'seat:booked', {
        screeningId: 10,
        seatIds: [11],
        status: SeatStatus.BOOKED,
      });
      expect(mockGateway.emitToRoom).not.toHaveBeenCalledWith(
        10,
        'screening:summary',
        expect.anything(),
      );
    });

    it('swallows a failing emit instead of throwing, and still broadcasts the summary', async () => {
      mockGateway.emitToRoom.mockImplementationOnce(() => {
        throw new Error('socket error');
      });

      await expect(
        listener.handleConfirmed({ screeningId: 10, seatIds: [11] }),
      ).resolves.toBeUndefined();

      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(
        10,
        'screening:summary',
        summary,
      );
    });
  });

  it('subscribes handleCreated to reservation.created, handleCancelled to reservation.cancelled, handleConfirmed to reservation.confirmed', () => {
    const createdEvents = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      listener.handleCreated,
    ) as Array<{ event: string }>;
    const cancelledEvents = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      listener.handleCancelled,
    ) as Array<{ event: string }>;
    const confirmedEvents = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      listener.handleConfirmed,
    ) as Array<{ event: string }>;

    expect(createdEvents.map((e) => e.event)).toEqual(['reservation.created']);
    expect(cancelledEvents.map((e) => e.event)).toEqual([
      'reservation.cancelled',
    ]);
    expect(confirmedEvents.map((e) => e.event)).toEqual([
      'reservation.confirmed',
    ]);
  });
});
