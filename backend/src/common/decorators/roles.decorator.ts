import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route handler (or controller) to the given roles.
 * Read by {@link RolesGuard}; compared against `req.user.role`.
 *
 * @example @Roles('ADMIN')
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
