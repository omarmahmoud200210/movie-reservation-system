import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './support/app';
import { resetState, closeRedis } from './support/db';
import { createAuthedUser } from './support/auth';
import { createPublishedMovie } from './support/fixtures';

describe('Movies (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await closeRedis();
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetState(prisma);
  });

  it('GET /api/v1/movies lists only published movies', async () => {
    await createPublishedMovie(prisma, { name: 'Published Movie' });
    await prisma.movie.create({
      data: {
        name: 'Draft Movie',
        description: 'unpublished',
        duration: 90,
        posterImgUrl: 'https://example.com/x.jpg',
        movieType: '2D',
        rating: 5,
        language: 'en',
        genre: 'Comedy',
      },
    });

    const res = await request(app.getHttpServer()).get('/api/v1/movies');

    expect(res.status).toBe(200);
    // Response is { nowShowing, comingSoon }, not a flat array.
    const { nowShowing, comingSoon } = res.body as {
      nowShowing: Array<{ name: string }>;
      comingSoon: Array<{ name: string }>;
    };
    const names = [...nowShowing, ...comingSoon].map((m) => m.name);
    expect(names).toContain('Published Movie');
    expect(names).not.toContain('Draft Movie');
  });

  it('POST /api/v1/movies rejects a non-admin with 403', async () => {
    const user = await createAuthedUser(prisma, { role: 'USER' });

    const res = await request(app.getHttpServer())
      .post('/api/v1/movies')
      .set('Cookie', user.cookie)
      .send({
        name: 'New Movie',
        description: 'desc',
        duration: 100,
        posterImgUrl: 'https://example.com/x.jpg',
        movieType: '2D',
        rating: 8,
        language: 'en',
        genre: 'Action',
      });

    expect(res.status).toBe(403);
  });

  it('an ADMIN can create then publish a movie', async () => {
    const admin = await createAuthedUser(prisma, { role: 'ADMIN' });

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/movies')
      .set('Cookie', admin.cookie)
      .send({
        name: 'Admin Movie',
        description: 'desc',
        duration: 100,
        posterImgUrl: 'https://example.com/x.jpg',
        movieType: '2D',
        rating: 8,
        language: 'en',
        genre: 'Action',
      });
    expect(createRes.status).toBe(201);

    const publishRes = await request(app.getHttpServer())
      .patch(`/api/v1/movies/${createRes.body.id}/publish`)
      .set('Cookie', admin.cookie);
    expect(publishRes.status).toBe(200);
    expect(publishRes.body.status).toBe('PUBLISHED');
  });
});
