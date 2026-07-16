import { Test, TestingModule } from '@nestjs/testing';
import { HoldExpiryCron } from '../hold-expiry.cron';
import { ReservationsService } from '../../reservations/reservations.service';
import { PaymentsService } from '../../payments/payments.service';
import { AuditService } from '../../common/services/audit.service';

const mockReservationsService = { expireHolds: jest.fn() };
const mockPaymentsService = { reconcileTimedOutPayments: jest.fn() };
const mockAudit = { record: jest.fn() };

describe('HoldExpiryCron', () => {
  let cron: HoldExpiryCron;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HoldExpiryCron,
        { provide: ReservationsService, useValue: mockReservationsService },
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: AuditService, useValue: mockAudit },
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

  it('calls PaymentsService.reconcileTimedOutPayments', async () => {
    mockPaymentsService.reconcileTimedOutPayments.mockResolvedValue(undefined);

    await cron.handleReconcilePayments();

    expect(mockPaymentsService.reconcileTimedOutPayments).toHaveBeenCalledTimes(1);
  });

  it('swallows a reconciliation failure instead of throwing', async () => {
    mockPaymentsService.reconcileTimedOutPayments.mockRejectedValue(
      new Error('Stripe down'),
    );

    await expect(cron.handleReconcilePayments()).resolves.toBeUndefined();
  });
});
