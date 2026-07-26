import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

export const CONCURRENCY_LIMIT = 'CONCURRENCY_LIMIT';

@Injectable()
export class ConcurrencyGuard {
  private active = 0;

  constructor(@Inject(CONCURRENCY_LIMIT) private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.max) {
      throw new ServiceUnavailableException(
        'System is under heavy load — please try again',
      );
    }
    this.active++;
    return () => {
      this.active--;
    };
  }
}
