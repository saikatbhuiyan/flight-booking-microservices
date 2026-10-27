jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@app/common';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  // Same shape auth-service's validateUser returns and JwtAuthGuard attaches to request.user.
  const contextFor = (user: Record<string, unknown>, roles?: Role[]) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);
    return {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  };
  const validatedUser = (role: Role) => ({ id: 1, email: 'a@b.c', firstName: 'A', lastName: 'B', role });

  it('allows an admin onto admin routes', () => {
    expect(guard.canActivate(contextFor(validatedUser(Role.ADMIN), [Role.ADMIN]))).toBe(true);
  });

  it('rejects a regular user on admin routes', () => {
    expect(guard.canActivate(contextFor(validatedUser(Role.USER), [Role.ADMIN]))).toBe(false);
  });

  it('allows any authenticated user when the route declares no roles', () => {
    expect(guard.canActivate(contextFor(validatedUser(Role.USER)))).toBe(true);
  });
});
