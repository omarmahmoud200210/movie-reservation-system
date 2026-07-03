import { Test, TestingModule } from '@nestjs/testing';
import { SeatStatus } from '@prisma/client';
import { ReservationBroadcastListener } from '../reservation-broadcast.listener';
import { ScreeningGateway } from '../screening.gateway';
import { ScreeningsService } from '../../screenings/screenings.service';

const mockGateway = { emitToRoom: jest.fn() };
const mockScreeningsService = { getScreeningSummary: jest.fn() };

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
      ],
    }).compile();

    listener = module.get<ReservationBroadcastListener>(
      ReservationBroadcastListener,
    );
  });

  describe('handleCreated', () => {
    it('broadcasts seat:reserved with HELD status and the screening summary', async () => {
      await listener.handleCreated({ screeningId: 10, seatIds: [1, 2] });

      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(
        10,
        'seat:reserved',
        { screeningId: 10, seatIds: [1, 2], status: SeatStatus.HELD },
      );
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

      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(
        10,
        'seat:reserved',
        { screeningId: 10, seatIds: [1], status: SeatStatus.HELD },
      );
      expect(mockGateway.emitToRoom).not.toHaveBeenCalledWith(
        10,
        'screening:summary',
        expect.anything(),
      );
    });

    it('swallows a failing emit instead of throwing', async () => {
      mockGateway.emitToRoom.mockImplementationOnce(() => {
        throw new Error('socket error');
      });

      await expect(
        listener.handleCreated({ screeningId: 10, seatIds: [1] }),
      ).resolves.toBeUndefined();
    });
  });

  describe('handleCancelled', () => {
    it('broadcasts seat:cancelled with AVAILABLE status and the screening summary', async () => {
      await listener.handleCancelled({ screeningId: 10, seatIds: [1] });

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

  it('subscribes handleCreated to reservation.created and handleCancelled to reservation.cancelled', () => {
    const createdEvents = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      listener.handleCreated,
    ) as Array<{ event: string }>;
    const cancelledEvents = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      listener.handleCancelled,
    ) as Array<{ event: string }>;

    expect(createdEvents.map((e) => e.event)).toEqual(['reservation.created']);
    expect(cancelledEvents.map((e) => e.event)).toEqual([
      'reservation.cancelled',
    ]);
  });
});
