/* eslint-disable @typescript-eslint/unbound-method */
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { AuthMessageController } from './authentication.controller';
import { AuthenticationService } from './authentication.service';

describe('AuthMessageController', () => {
  let controller: AuthMessageController;
  let authService: jest.Mocked<AuthenticationService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthMessageController],
      providers: [
        {
          provide: AuthenticationService,
          useValue: {
            register: jest.fn(),
            signIn: jest.fn(),
            refreshTokens: jest.fn(),
            signOut: jest.fn(),
            validateUser: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AuthMessageController);
    authService = module.get(AuthenticationService);
  });

  it('returns the raw service result for register (the gateway wraps the envelope)', async () => {
    const user = { id: 1, email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe' };
    authService.register.mockResolvedValue(user as never);

    await expect(
      controller.register({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        password: 'Password123!',
      }),
    ).resolves.toEqual(user);
  });

  it('delegates login to the auth service', async () => {
    authService.signIn.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });

    await expect(
      controller.login({
        email: 'jane@example.com',
        password: 'Password123!',
        deviceId: 'device-1',
        clientType: undefined,
      }),
    ).resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' });

    expect(authService.signIn).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@example.com' }), undefined);
  });

  it('passes the client IP from the gateway to the audit trail, not as a credential field', async () => {
    authService.signIn.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });

    await controller.login({ email: 'jane@example.com', password: 'Password123!', deviceId: 'd1', ip: '10.0.0.9' });

    expect(authService.signIn).toHaveBeenCalledWith(expect.not.objectContaining({ ip: expect.anything() }), '10.0.0.9');
  });

  it('returns the raw service result for refresh', async () => {
    authService.refreshTokens.mockResolvedValue({ accessToken: 'next-access', refreshToken: 'next-refresh' });

    await expect(
      controller.refresh({ refreshToken: 'refresh-token', deviceId: 'device-1', clientType: undefined }),
    ).resolves.toEqual({ accessToken: 'next-access', refreshToken: 'next-refresh' });
  });

  it('delegates sign-out and user validation to the auth service', async () => {
    authService.validateUser.mockResolvedValue({
      id: 1,
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      roles: [],
    } as never);

    await controller.signOut({ userId: 1, deviceId: 'device-1', clientType: undefined });
    await controller.validateUser({ id: 1, email: 'jane@example.com' });

    expect(authService.signOut).toHaveBeenCalledWith(expect.objectContaining({ userId: 1 }));
    expect(authService.validateUser).toHaveBeenCalledWith({ id: 1, email: 'jane@example.com' });
  });
});
