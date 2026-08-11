import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: number): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  updateName(id: number, name: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { name } });
  }

  updateEmail(id: number, email: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { email } });
  }

  updatePassword(id: number, password: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { password } });
  }
}
