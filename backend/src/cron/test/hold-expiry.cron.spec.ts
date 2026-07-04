import { Test, TestingModule } from '@nestjs/testing';
import { HoldExpiryCron } from '../hold-expiry.cron';
import { ReservationsService } from '../../reservations/reservations.service';

const mockReservationsService = { expireHolds: jest.fn() };

describe('HoldExpiryCron', () => {
  let cron: HoldExpiryCron;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HoldExpiryCron,
        { provide: ReservationsService, useValue: mockReservationsService },
      ],
    }).compile();

    cron = module.get<HoldExpiryCron>(HoldExpiryCron);
  });

  it('calls ReservationsService.expireHolds', async () => {
    mockReservationsService.expireHolds.mockResolvedValue(undefined);

    await cron.handleExpireHolds();

    expect(mockReservationsService.expireHolds).toHaveBeenCalledTimes(1);
  });

  it('swallows a failure instead of throwing', async () => {
    mockReservationsService.expireHolds.mockRejectedValue(
      new Error('DB down'),
    );

    await expect(cron.handleExpireHolds()).resolves.toBeUndefined();
  });
});
