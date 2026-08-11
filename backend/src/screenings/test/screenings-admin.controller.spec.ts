import { Test, TestingModule } from '@nestjs/testing';
import { ScreeningsAdminController } from '../screenings-admin.controller';
import { ScreeningsService } from '../screenings.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AuditService } from '../../common/services/audit.service';
import { UserRole } from '@prisma/client';

const mockService = {
  createScreening: jest.fn(),
  updateScreening: jest.fn(),
  cancelScreening: jest.fn(),
  deleteScreening: jest.fn(),
};

const mockAuditService = {
  record: jest.fn(),
};

const user = { id: 1, email: 'admin@test.com', name: 'Admin', role: UserRole.ADMIN };

const GUARDS_METADATA = '__guards__';

describe('ScreeningsAdminController', () => {
  let controller: ScreeningsAdminController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScreeningsAdminController],
      providers: [
        { provide: ScreeningsService, useValue: mockService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    controller = module.get<ScreeningsAdminController>(
      ScreeningsAdminController,
    );
  });

  describe('delegation', () => {
    it('create -> screeningsService.createScreening', async () => {
      const dto = { movieId: 1, hallId: 2, startTime: 'x', price: 10 } as never;
      mockService.createScreening.mockResolvedValue({ id: 1 });

      await controller.create(dto, user);

      expect(mockService.createScreening).toHaveBeenCalledWith(dto);
      expect(mockAuditService.record).toHaveBeenCalled();
    });

    it('update -> screeningsService.updateScreening with id + dto', async () => {
      const dto = { price: 20 } as never;
      mockService.updateScreening.mockResolvedValue({ id: 1 });

      await controller.update(1, dto, user);

      expect(mockService.updateScreening).toHaveBeenCalledWith(1, dto);
      expect(mockAuditService.record).toHaveBeenCalled();
    });

    it('cancel -> screeningsService.cancelScreening', async () => {
      mockService.cancelScreening.mockResolvedValue({ id: 1 });

      await controller.cancel(1, user);

      expect(mockService.cancelScreening).toHaveBeenCalledWith(1);
      expect(mockAuditService.record).toHaveBeenCalled();
    });

    it('remove -> screeningsService.deleteScreening', async () => {
      mockService.deleteScreening.mockResolvedValue({ id: 1 });

      await controller.remove(1, user);

      expect(mockService.deleteScreening).toHaveBeenCalledWith(1);
      expect(mockAuditService.record).toHaveBeenCalled();
    });
  });

  // All routes are ADMIN-only -> guards applied class-wide.
  describe('guard wiring (class-level)', () => {
    it('guards the whole controller with JwtAuthGuard + RolesGuard', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        ScreeningsAdminController,
      );
      expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
    });

    it('restricts the whole controller to @Roles(ADMIN)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, ScreeningsAdminController);
      expect(roles).toEqual(['ADMIN']);
    });
  });
});
