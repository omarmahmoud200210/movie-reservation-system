import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailerModule } from '../mailer/mailer.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';

/**
 * Authenticated user-settings actions (name, email, password). Imports
 * AuthModule for AuthService/OtpService/TokenService and MailerModule for
 * MailerService. Prisma and Redis are global, no explicit import needed.
 */
@Module({
  imports: [AuthModule, MailerModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
})
export class UsersModule {}
