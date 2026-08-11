import { Test, TestingModule } from '@nestjs/testing';
import { MoviesAdminController } from '../movies-admin.controller';
import { MoviesService } from '../movies.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AuditService } from '../../common/services/audit.service';
import { UserRole } from '@prisma/client';

const mockService = {
  createMovie: jest.fn(),
  updateMovie: jest.fn(),
  publish: jest.fn(),
  unpublish: jest.fn(),
  deleteMovie: jest.fn(),
  listAllForAdmin: jest.fn(),
};

const mockAuditService = {
  record: jest.fn(),
};

const user = { id: 1, email: 'admin@test.com', name: 'Admin', role: UserRole.ADMIN };

// Key Nest uses to store @UseGuards metadata.
const GUARDS_METADATA = '__guards__';

describe('MoviesAdminController', () => {
  let controller: MoviesAdminController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MoviesAdminController],
      providers: [
        { provide: MoviesService, useValue: mockService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    controller = module.get<MoviesAdminController>(MoviesAdminController);
  });

  describe('delegation', () => {
    it('create -> moviesService.createMovie', async () => {
      const dto = { name: 'Inception' } as never;
      mockService.createMovie.mockResolvedValue({ id: 1 });

      await controller.create(dto, user);

      expect(mockService.createMovie).toHaveBeenCalledWith(dto);
      expect(mockAuditService.record).toHaveBeenCalled();
    });

    it('update -> moviesService.updateMovie with id + dto', async () => {
      const dto = { name: 'New' } as never;
      mockService.updateMovie.mockResolvedValue({ id: 1 });

      await controller.update(1, dto, user);

      expect(mockService.updateMovie).toHaveBeenCalledWith(1, dto);
      expect(mockAuditService.record).toHaveBeenCalled();
    });

    it('publish -> moviesService.publish', async () => {
      mockService.publish.mockResolvedValue({ id: 1 });

      await controller.publish(1, user);

      expect(mockService.publish).toHaveBeenCalledWith(1);
      expect(mockAuditService.record).toHaveBeenCalled();
    });

    it('unpublish -> moviesService.unpublish', async () => {
      mockService.unpublish.mockResolvedValue({ id: 1 });

      await controller.unpublish(1, user);

      expect(mockService.unpublish).toHaveBeenCalledWith(1);
      expect(mockAuditService.record).toHaveBeenCalled();
    });

    it('remove -> moviesService.deleteMovie', async () => {
      mockService.deleteMovie.mockResolvedValue({ id: 1 });

      await controller.remove(1, user);

      expect(mockService.deleteMovie).toHaveBeenCalledWith(1);
      expect(mockAuditService.record).toHaveBeenCalled();
    });

    it('listAll -> moviesService.listAllForAdmin', async () => {
      mockService.listAllForAdmin.mockResolvedValue([]);

      await controller.listAll();

      expect(mockService.listAllForAdmin).toHaveBeenCalled();
    });
  });

  // Every route is ADMIN-only, so guards are applied CLASS-WIDE. Assert the
  // metadata sits on the controller class itself — proving no admin route is
  // accidentally left public.
  describe('guard wiring (class-level)', () => {
    it('guards the whole controller with JwtAuthGuard + RolesGuard', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        MoviesAdminController,
      );
      expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
    });

    it('restricts the whole controller to @Roles(ADMIN)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, MoviesAdminController);
      expect(roles).toEqual(['ADMIN']);
    });
  });
});
