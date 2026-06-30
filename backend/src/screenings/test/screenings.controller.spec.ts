import { Test, TestingModule } from '@nestjs/testing';
import { ScreeningsController } from '../screenings.controller';
import { ScreeningsService } from '../screenings.service';

const mockService = {
  getMovieScreenings: jest.fn(),
  getScreeningDetail: jest.fn(),
  getSeatMap: jest.fn(),
};

const GUARDS_METADATA = '__guards__';

describe('ScreeningsController (public)', () => {
  let controller: ScreeningsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScreeningsController],
      providers: [{ provide: ScreeningsService, useValue: mockService }],
    }).compile();

    controller = module.get<ScreeningsController>(ScreeningsController);
  });

  describe('delegation', () => {
    it('movieScreenings -> screeningsService.getMovieScreenings', async () => {
      mockService.getMovieScreenings.mockResolvedValue([]);

      await controller.movieScreenings(5);

      expect(mockService.getMovieScreenings).toHaveBeenCalledWith(5);
    });

    it('detail -> screeningsService.getScreeningDetail', async () => {
      mockService.getScreeningDetail.mockResolvedValue({ id: 1 });

      await controller.detail(1);

      expect(mockService.getScreeningDetail).toHaveBeenCalledWith(1);
    });

    it('seats -> screeningsService.getSeatMap', async () => {
      mockService.getSeatMap.mockResolvedValue([]);

      await controller.seats(1);

      expect(mockService.getSeatMap).toHaveBeenCalledWith(1);
    });
  });

  // Public reads: no guards on the class or any method.
  describe('public (no guards)', () => {
    it('has no class-level guards', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, ScreeningsController),
      ).toBeUndefined();
    });

    it('has no method-level guards', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, controller.movieScreenings),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(GUARDS_METADATA, controller.detail),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(GUARDS_METADATA, controller.seats),
      ).toBeUndefined();
    });
  });
});
