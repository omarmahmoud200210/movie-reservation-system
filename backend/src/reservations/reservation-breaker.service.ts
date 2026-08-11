import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import CircuitBreaker from 'opossum';
import {
  ReservationsRepository,
  type HoldSeatParams,
} from './reservations.repository';
import type { Reservation } from '@prisma/client';

export const RESERVATION_BREAKER_OPTIONS = 'RESERVATION_BREAKER_OPTIONS';

@Injectable()
export class ReservationBreaker {
  private readonly breaker: CircuitBreaker<[HoldSeatParams], Reservation>;

  constructor(
    private readonly reservationsRepo: ReservationsRepository,
    @Inject(RESERVATION_BREAKER_OPTIONS)
    private readonly options: CircuitBreaker.Options,
  ) {
    this.breaker = new CircuitBreaker<[HoldSeatParams], Reservation>(
      (params) => this.reservationsRepo.holdSeat(params),
      {
        ...options,
        errorFilter: (err) =>
          err instanceof HttpException && err.getStatus() < 500,
      },
    );
  }

  async holdSeat(params: HoldSeatParams): Promise<Reservation> {
    try {
      return await this.breaker.fire(params);
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      throw new ServiceUnavailableException(
        'System is under heavy load — please try again',
      );
    }
  }

  get status() {
    return this.breaker.toJSON();
  }
}
