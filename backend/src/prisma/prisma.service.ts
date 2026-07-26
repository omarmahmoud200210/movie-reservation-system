import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly read: PrismaClient;
  readonly write: PrismaClient;
  private readPool: Pool;
  private writePool: Pool;

  constructor() {
    const sharedConfig = {
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ...(process.env.NODE_ENV === 'production' && {
        ssl: { rejectUnauthorized: true },
      }),
    };

    this.readPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 15,
      min: 2,
      ...sharedConfig,
    });
    this.writePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
      min: 1,
      ...sharedConfig,
    });

    this.read = new PrismaClient({ adapter: new PrismaPg(this.readPool) });
    this.write = new PrismaClient({ adapter: new PrismaPg(this.writePool) });
  }

  async onModuleInit() {
    await this.read.$connect();
    await this.write.$connect();
  }

  async onModuleDestroy() {
    await this.read.$disconnect();
    await this.write.$disconnect();
    await this.readPool.end();
    await this.writePool.end();
  }
}
