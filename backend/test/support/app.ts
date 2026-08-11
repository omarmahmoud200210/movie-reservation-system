// backend/test/support/app.ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';

interface TestAppOverrides {
  overrides?: Array<{ provide: unknown; useValue: unknown }>;
}

/** Boots the real app the same way main.ts does (prefix, cookies, pipes),
 * against a real ephemeral port so Socket.IO clients can connect. */
export async function createTestApp(
  opts: TestAppOverrides = {},
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  for (const o of opts.overrides ?? []) {
    builder = builder.overrideProvider(o.provide as never).useValue(o.useValue);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.listen(0);

  return app;
}

export function baseUrl(app: INestApplication): string {
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}
