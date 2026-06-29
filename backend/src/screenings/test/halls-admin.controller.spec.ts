import { Test, TestingModule } from '@nestjs/testing';
import { HallsAdminController } from '../halls-admin.controller';
import { HallsService } from '../halls.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

const mockService = {
  createHall: jest.fn(),
  getHall: jest.fn(),
  listHalls: jest.fn(),
  deleteHall: jest.fn(),
};

// Key Nest uses to store @UseGuards metadata.
const GUARDS_METADATA = '__guards__';

describe('HallsAdminController', () => {
  let controller: HallsAdminController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HallsAdminController],
      providers: [{ provide: HallsService, useValue: mockService }],
    }).compile();

    controller = module.get<HallsAdminController>(HallsAdminController);
  });

  describe('delegation', () => {
    it('create -> hallsService.createHall', async () => {
      const dto = { name: 'Hall 1', rows: 8, seatsPerRow: 12 };
      mockService.createHall.mockResolvedValue({ id: 1 });

      await controller.create(dto);

      expect(mockService.createHall).toHaveBeenCalledWith(dto);
    });

    it('list -> hallsService.listHalls', async () => {
      mockService.listHalls.mockResolvedValue([]);

      await controller.list();

      expect(mockService.listHalls).toHaveBeenCalled();
    });

    it('getOne -> hallsService.getHall with the numeric id', async () => {
      mockService.getHall.mockResolvedValue({ id: 5 });

      await controller.getOne(5);

      expect(mockService.getHall).toHaveBeenCalledWith(5);
    });

    it('remove -> hallsService.deleteHall with the numeric id', async () => {
      mockService.deleteHall.mockResolvedValue({ id: 5 });

      await controller.remove(5);

      expect(mockService.deleteHall).toHaveBeenCalledWith(5);
    });
  });

  // Guards are applied PER METHOD here (not class-level) because GET /halls/:id
  // must stay public. A wrong placement would either expose writes or make the
  // seat-picking read admin-only, so we assert each route's guards explicitly.
  describe('guard wiring', () => {
    const guardsOf = (handler: unknown) =>
      Reflect.getMetadata(GUARDS_METADATA, handler as object) ?? [];
    const rolesOf = (handler: unknown) =>
      Reflect.getMetadata(ROLES_KEY, handler as object);

    it('protects create with JwtAuthGuard + RolesGuard + @Roles(ADMIN)', () => {
      expect(guardsOf(controller.create)).toEqual([JwtAuthGuard, RolesGuard]);
      expect(rolesOf(controller.create)).toEqual(['ADMIN']);
    });

    it('protects list with JwtAuthGuard + RolesGuard + @Roles(ADMIN)', () => {
      expect(guardsOf(controller.list)).toEqual([JwtAuthGuard, RolesGuard]);
      expect(rolesOf(controller.list)).toEqual(['ADMIN']);
    });

    it('protects remove with JwtAuthGuard + RolesGuard + @Roles(ADMIN)', () => {
      expect(guardsOf(controller.remove)).toEqual([JwtAuthGuard, RolesGuard]);
      expect(rolesOf(controller.remove)).toEqual(['ADMIN']);
    });

    it('leaves GET /halls/:id public (no guards, no roles)', () => {
      expect(guardsOf(controller.getOne)).toEqual([]);
      expect(rolesOf(controller.getOne)).toBeUndefined();
    });
  });

  // NOTE: ParseIntPipe coercion of `:id` runs in the HTTP pipeline, not on
  // direct method calls, so it is out of scope for these unit tests — it would
  // need an e2e/supertest case.
});
