import { Test, TestingModule } from '@nestjs/testing';
import { MoviesController } from '../movies.controller';
import { MoviesService } from '../movies.service';

const mockService = {
  browseMovies: jest.fn(),
  getPublishedMovie: jest.fn(),
};

const GUARDS_METADATA = '__guards__';

describe('MoviesController (public)', () => {
  let controller: MoviesController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MoviesController],
      providers: [{ provide: MoviesService, useValue: mockService }],
    }).compile();

    controller = module.get<MoviesController>(MoviesController);
  });

  describe('delegation', () => {
    it('browse -> moviesService.browseMovies', async () => {
      mockService.browseMovies.mockResolvedValue({
        nowShowing: [],
        comingSoon: [],
      });

      await controller.browse();

      expect(mockService.browseMovies).toHaveBeenCalled();
    });

    it('detail -> moviesService.getPublishedMovie with the id', async () => {
      mockService.getPublishedMovie.mockResolvedValue({ id: 5 });

      await controller.detail(5);

      expect(mockService.getPublishedMovie).toHaveBeenCalledWith(5);
    });
  });

  // Public catalog: no guards should be attached, on the class or the methods.
  describe('public (no guards)', () => {
    it('has no class-level guards', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, MoviesController),
      ).toBeUndefined();
    });

    it('has no method-level guards', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, controller.browse),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(GUARDS_METADATA, controller.detail),
      ).toBeUndefined();
    });
  });
});
