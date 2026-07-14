// backend/test/support/auth.ts
import * as bcrypt from 'bcrypt';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { PrismaClient, UserRole } from '@prisma/client';

const jwt = new JwtService();
let counter = 0;

export interface TestUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  /** Pass directly to `.set('Cookie', testUser.cookie)` in Supertest. */
  cookie: string;
}

/** Inserts a verified User row directly (skips register/OTP) and signs a
 * real access token via the same secret/payload shape TokenService uses,
 * so the real JwtAuthGuard/JwtStrategy validate it identically to a token
 * issued through login. */
export async function createAuthedUser(
  prisma: PrismaClient,
  overrides: { role?: UserRole; email?: string; name?: string } = {},
): Promise<TestUser> {
  counter += 1;
  const email = overrides.email ?? `e2e-user-${counter}@test.local`;
  const name = overrides.name ?? 'E2E Test User';
  const role = overrides.role ?? UserRole.USER;

  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: await bcrypt.hash('Password123!', 10),
      emailVerified: true,
      role,
    },
  });

  const accessToken = jwt.sign(
    { sub: user.id, name: user.name, email: user.email, role: user.role },
    {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN,
    } as JwtSignOptions,
  );

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    cookie: `access_token=${accessToken}`,
  };
}
