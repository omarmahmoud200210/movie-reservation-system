import { Injectable, Logger } from '@nestjs/common';
import { Movie } from '@prisma/client';
import RedisCache from '../redis/redis.cache';

const movieKey = (id: number) => `movie:${id}`;
const NOW_SHOWING_KEY = 'movies:now_showing';
const COMING_SOON_KEY = 'movies:coming_soon';

const MOVIE_TTL_SECONDS = 3600; // 1h — movie metadata is fairly static
const LIST_TTL_SECONDS = 60; // 60s — browse split shifts as screenings pass

export interface BrowseLists {
  nowShowing: Movie[];
  comingSoon: Movie[];
}

/**
 * Cache-aside helpers for movie detail + the two browse lists.
 * Every operation is best-effort: Redis errors are logged and swallowed so
 * reads fall back to Postgres rather than failing the request.
 */
@Injectable()
export class MoviesCache {
  private readonly logger = new Logger(MoviesCache.name);

  constructor(private readonly redis: RedisCache) {}

  async getMovie(id: number): Promise<Movie | null> {
    try {
      const raw = await this.redis.get(movieKey(id));
      return raw ? (JSON.parse(raw) as Movie) : null;
    } catch (err) {
      this.logger.warn(`getMovie(${id}) cache miss on error: ${String(err)}`);
      return null;
    }
  }

  async setMovie(movie: Movie): Promise<void> {
    try {
      await this.redis.set(
        movieKey(movie.id),
        JSON.stringify(movie),
        'EX',
        MOVIE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(`setMovie(${movie.id}) failed: ${String(err)}`);
    }
  }

  async delMovie(id: number): Promise<void> {
    try {
      await this.redis.del(movieKey(id));
    } catch (err) {
      this.logger.warn(`delMovie(${id}) failed: ${String(err)}`);
    }
  }

  /** Both browse lists, or null if either key is absent (treat as a miss). */
  async getLists(): Promise<BrowseLists | null> {
    try {
      const [nowRaw, soonRaw] = await Promise.all([
        this.redis.get(NOW_SHOWING_KEY),
        this.redis.get(COMING_SOON_KEY),
      ]);
      if (nowRaw === null || soonRaw === null) {
        return null;
      }
      return {
        nowShowing: JSON.parse(nowRaw) as Movie[],
        comingSoon: JSON.parse(soonRaw) as Movie[],
      };
    } catch (err) {
      this.logger.warn(`getLists cache miss on error: ${String(err)}`);
      return null;
    }
  }

  async setLists(lists: BrowseLists): Promise<void> {
    try {
      await Promise.all([
        this.redis.set(
          NOW_SHOWING_KEY,
          JSON.stringify(lists.nowShowing),
          'EX',
          LIST_TTL_SECONDS,
        ),
        this.redis.set(
          COMING_SOON_KEY,
          JSON.stringify(lists.comingSoon),
          'EX',
          LIST_TTL_SECONDS,
        ),
      ]);
    } catch (err) {
      this.logger.warn(`setLists failed: ${String(err)}`);
    }
  }

  async delLists(): Promise<void> {
    try {
      await this.redis.del(NOW_SHOWING_KEY, COMING_SOON_KEY);
    } catch (err) {
      this.logger.warn(`delLists failed: ${String(err)}`);
    }
  }
}
