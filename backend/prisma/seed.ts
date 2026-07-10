// backend/prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.refundPolicy.upsert({
    where: { hoursFrom_hoursTo: { hoursFrom: 48, hoursTo: 100_000 } },
    update: { refundPercent: 100 },
    create: { hoursFrom: 48, hoursTo: 100_000, refundPercent: 100 },
  });
  await prisma.refundPolicy.upsert({
    where: { hoursFrom_hoursTo: { hoursFrom: 24, hoursTo: 48 } },
    update: { refundPercent: 50 },
    create: { hoursFrom: 24, hoursTo: 48, refundPercent: 50 },
  });
  await prisma.refundPolicy.upsert({
    where: { hoursFrom_hoursTo: { hoursFrom: 0, hoursTo: 24 } },
    update: { refundPercent: 0 },
    create: { hoursFrom: 0, hoursTo: 24, refundPercent: 0 },
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
