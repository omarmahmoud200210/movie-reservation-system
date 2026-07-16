import type { MiddlewareConsumer } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { AppModule } from '../app.module';
import { IpRateLimitMiddleware } from '../common/middleware/ip-rate-limit.middleware';

describe('AppModule', () => {
  describe('configure', () => {
    it('applies IpRateLimitMiddleware to POST auth/login and GET movies', () => {
      const forRoutes = jest.fn();
      const apply = jest.fn().mockReturnValue({ forRoutes });
      const consumer = { apply } as unknown as MiddlewareConsumer;

      new AppModule().configure(consumer);

      expect(apply).toHaveBeenCalledWith(IpRateLimitMiddleware);
      expect(forRoutes).toHaveBeenCalledWith(
        { path: 'auth/login', method: RequestMethod.POST },
        { path: 'movies', method: RequestMethod.GET },
        { path: 'auth/register', method: RequestMethod.POST },
        { path: 'auth/verify-otp', method: RequestMethod.POST },
        { path: 'auth/resend-otp', method: RequestMethod.POST },
        { path: 'auth/refresh', method: RequestMethod.POST },
      );
    });
  });
});
