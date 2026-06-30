import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MovieStatus } from '@prisma/client';
import { MoviesService } from '../movies.service';
import { MoviesRepository } from '../movies.repository';
import { MoviesCache } from '../movies.cache';

const mockRepo = {
  create: jest.fn(),
  update: jest.fn(),
  findById: jest.fn(),
  setStatus: jest.fn(),
  delete: jest.fn(),
  listAll: jest.fn(),
  hasReservations: jest.fn(),
  findPublishedById: jest.fn(),
  findPublishedForBrowse: jest.fn(),
};

const mockCache = {
  getMovie: jest.fn(),
  setMovie: jest.fn(),
  delMovie: jest.fn(),
  getLists: jest.fn(),
  setLists: jest.fn(),
  delLists: jest.fn(),
};

const createDto = {
  name: 'Inception',
  description: 'A thief who steals corporate secrets.',
  duration: 148,
  posterImgUrl: 'https://example.com/inception.jpg',
  movieType: '2D',
  rating: 8.8,
  language: 'English',
  genre: 'Sci-Fi',
};

const draftMovie = { id: 1, ...createDto, status: MovieStatus.DRAFT };
const publishedMovie = { ...draftMovie, status: MovieStatus.PUBLISHED };

describe('MoviesService', () => {
  let service: MoviesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MoviesService,
        { provide: MoviesRepository, useValue: mockRepo },
        { provide: MoviesCache, useValue: mockCache },
      ],
    }).compile();

    service = module.get<MoviesService>(MoviesService);
  });

  describe('createMovie', () => {
    it('delegates to repo.create and returns the created movie', async () => {
      mockRepo.create.mockResolvedValue(draftMovie);

      await expect(service.createMovie(createDto)).resolves.toBe(draftMovie);
      expect(mockRepo.create).toHaveBeenCalledWith(createDto);
    });

    it('does not set status explicitly (relies on the schema DRAFT default)', async () => {
      mockRepo.create.mockResolvedValue(draftMovie);

      await service.createMovie(createDto);

      const arg = mockRepo.create.mock.calls[0][0];
      expect(arg).not.toHaveProperty('status');
    });
  });

  describe('updateMovie', () => {
    it('updates an existing movie', async () => {
      mockRepo.findById.mockResolvedValue(draftMovie);
      mockRepo.update.mockResolvedValue({ ...draftMovie, name: 'New Name' });

      const result = await service.updateMovie(1, { name: 'New Name' });

      expect(mockRepo.update).toHaveBeenCalledWith(1, { name: 'New Name' });
      expect(result.name).toBe('New Name');
    });

    it('throws NotFoundException for an unknown id and never updates', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateMovie(99, { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('flips a DRAFT movie to PUBLISHED', async () => {
      mockRepo.findById.mockResolvedValue(draftMovie);
      mockRepo.setStatus.mockResolvedValue(publishedMovie);

      await expect(service.publish(1)).resolves.toBe(publishedMovie);
      expect(mockRepo.setStatus).toHaveBeenCalledWith(1, MovieStatus.PUBLISHED);
    });

    it('rejects publishing an already-PUBLISHED movie with 400', async () => {
      mockRepo.findById.mockResolvedValue(publishedMovie);

      await expect(service.publish(1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockRepo.setStatus).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown id', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.publish(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('unpublish', () => {
    it('flips a PUBLISHED movie to DRAFT', async () => {
      mockRepo.findById.mockResolvedValue(publishedMovie);
      mockRepo.setStatus.mockResolvedValue(draftMovie);

      await expect(service.unpublish(1)).resolves.toBe(draftMovie);
      expect(mockRepo.setStatus).toHaveBeenCalledWith(1, MovieStatus.DRAFT);
    });

    it('rejects unpublishing an already-DRAFT movie with 400', async () => {
      mockRepo.findById.mockResolvedValue(draftMovie);

      await expect(service.unpublish(1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockRepo.setStatus).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown id', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.unpublish(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('deleteMovie', () => {
    it('deletes when the movie exists and has no reservations', async () => {
      mockRepo.findById.mockResolvedValue(draftMovie);
      mockRepo.hasReservations.mockResolvedValue(false);
      mockRepo.delete.mockResolvedValue(draftMovie);

      await expect(service.deleteMovie(1)).resolves.toBe(draftMovie);
      expect(mockRepo.delete).toHaveBeenCalledWith(1);
    });

    it('throws ConflictException (409) when the movie has reservations', async () => {
      mockRepo.findById.mockResolvedValue(draftMovie);
      mockRepo.hasReservations.mockResolvedValue(true);

      await expect(service.deleteMovie(1)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockRepo.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException (404) for an unknown id and checks nothing else', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.deleteMovie(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockRepo.hasReservations).not.toHaveBeenCalled();
      expect(mockRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('listAllForAdmin', () => {
    it('delegates to repo.listAll and returns the list unchanged', async () => {
      const movies = [draftMovie, publishedMovie];
      mockRepo.listAll.mockResolvedValue(movies);

      await expect(service.listAllForAdmin()).resolves.toBe(movies);
      expect(mockRepo.listAll).toHaveBeenCalled();
    });
  });

  describe('browseMovies', () => {
    // Repo returns published movies each tagged with a `screens` marker:
    // non-empty => has a future scheduled screening.
    const withScreens = { ...publishedMovie, id: 1, screens: [{ id: 10 }] };
    const noScreens = { ...publishedMovie, id: 2, screens: [] };

    it('puts a movie with a future scheduled screening in nowShowing', async () => {
      mockRepo.findPublishedForBrowse.mockResolvedValue([withScreens]);

      const result = await service.browseMovies();

      expect(result.nowShowing.map((m) => m.id)).toEqual([1]);
      expect(result.comingSoon).toEqual([]);
    });

    it('puts a published movie with no future screening in comingSoon (not dropped)', async () => {
      mockRepo.findPublishedForBrowse.mockResolvedValue([noScreens]);

      const result = await service.browseMovies();

      expect(result.comingSoon.map((m) => m.id)).toEqual([2]);
      expect(result.nowShowing).toEqual([]);
    });

    it('splits a mixed set into both buckets', async () => {
      mockRepo.findPublishedForBrowse.mockResolvedValue([withScreens, noScreens]);

      const result = await service.browseMovies();

      expect(result.nowShowing.map((m) => m.id)).toEqual([1]);
      expect(result.comingSoon.map((m) => m.id)).toEqual([2]);
    });

    it('strips the screens marker from the returned movies', async () => {
      mockRepo.findPublishedForBrowse.mockResolvedValue([withScreens, noScreens]);

      const result = await service.browseMovies();

      [...result.nowShowing, ...result.comingSoon].forEach((m) => {
        expect(m).not.toHaveProperty('screens');
      });
    });

    it('returns empty buckets when there are no published movies', async () => {
      mockRepo.findPublishedForBrowse.mockResolvedValue([]);

      await expect(service.browseMovies()).resolves.toEqual({
        nowShowing: [],
        comingSoon: [],
      });
    });

    it('passes a Date (now) to the repository', async () => {
      mockRepo.findPublishedForBrowse.mockResolvedValue([]);

      await service.browseMovies();

      const arg = mockRepo.findPublishedForBrowse.mock.calls[0][0];
      expect(arg).toBeInstanceOf(Date);
    });
  });

  describe('getPublishedMovie', () => {
    it('returns the movie when it is published', async () => {
      mockRepo.findPublishedById.mockResolvedValue(publishedMovie);

      await expect(service.getPublishedMovie(1)).resolves.toBe(publishedMovie);
    });

    it('throws 404 when the movie is a draft or unknown', async () => {
      mockRepo.findPublishedById.mockResolvedValue(null);

      await expect(service.getPublishedMovie(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('caching', () => {
    describe('browseMovies (cache-aside)', () => {
      it('serves from cache on a hit without querying the repo', async () => {
        const lists = { nowShowing: [publishedMovie], comingSoon: [] };
        mockCache.getLists.mockResolvedValue(lists);

        await expect(service.browseMovies()).resolves.toBe(lists);
        expect(mockRepo.findPublishedForBrowse).not.toHaveBeenCalled();
      });

      it('populates the cache on a miss', async () => {
        mockCache.getLists.mockResolvedValue(null);
        mockRepo.findPublishedForBrowse.mockResolvedValue([]);

        await service.browseMovies();

        expect(mockCache.setLists).toHaveBeenCalledWith({
          nowShowing: [],
          comingSoon: [],
        });
      });
    });

    describe('getPublishedMovie (cache-aside)', () => {
      it('serves from cache on a hit without querying the repo', async () => {
        mockCache.getMovie.mockResolvedValue(publishedMovie);

        await expect(service.getPublishedMovie(1)).resolves.toBe(
          publishedMovie,
        );
        expect(mockRepo.findPublishedById).not.toHaveBeenCalled();
      });

      it('populates the cache on a miss', async () => {
        mockCache.getMovie.mockResolvedValue(null);
        mockRepo.findPublishedById.mockResolvedValue(publishedMovie);

        await service.getPublishedMovie(1);

        expect(mockCache.setMovie).toHaveBeenCalledWith(publishedMovie);
      });
    });

    describe('write invalidation', () => {
      it('updateMovie clears movie:{id}', async () => {
        mockRepo.findById.mockResolvedValue(draftMovie);
        mockRepo.update.mockResolvedValue(draftMovie);

        await service.updateMovie(1, { name: 'x' });

        expect(mockCache.delMovie).toHaveBeenCalledWith(1);
        expect(mockCache.delLists).not.toHaveBeenCalled();
      });

      it('publish clears the browse lists', async () => {
        mockRepo.findById.mockResolvedValue(draftMovie);
        mockRepo.setStatus.mockResolvedValue(publishedMovie);

        await service.publish(1);

        expect(mockCache.delLists).toHaveBeenCalled();
      });

      it('unpublish clears movie:{id} and the browse lists', async () => {
        mockRepo.findById.mockResolvedValue(publishedMovie);
        mockRepo.setStatus.mockResolvedValue(draftMovie);

        await service.unpublish(1);

        expect(mockCache.delMovie).toHaveBeenCalledWith(1);
        expect(mockCache.delLists).toHaveBeenCalled();
      });

      it('deleteMovie clears movie:{id} and the browse lists', async () => {
        mockRepo.findById.mockResolvedValue(draftMovie);
        mockRepo.hasReservations.mockResolvedValue(false);
        mockRepo.delete.mockResolvedValue(draftMovie);

        await service.deleteMovie(1);

        expect(mockCache.delMovie).toHaveBeenCalledWith(1);
        expect(mockCache.delLists).toHaveBeenCalled();
      });

      it('createMovie touches no cache (drafts are invisible)', async () => {
        mockRepo.create.mockResolvedValue(draftMovie);

        await service.createMovie(createDto);

        expect(mockCache.delMovie).not.toHaveBeenCalled();
        expect(mockCache.delLists).not.toHaveBeenCalled();
      });
    });
  });
});
