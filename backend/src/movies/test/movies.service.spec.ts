import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MovieStatus } from '@prisma/client';
import { MoviesService } from '../movies.service';
import { MoviesRepository } from '../movies.repository';

const mockRepo = {
  create: jest.fn(),
  update: jest.fn(),
  findById: jest.fn(),
  setStatus: jest.fn(),
  delete: jest.fn(),
  listAll: jest.fn(),
  hasReservations: jest.fn(),
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
});
