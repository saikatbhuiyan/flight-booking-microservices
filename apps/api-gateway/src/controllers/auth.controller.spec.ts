/* eslint-disable @typescript-eslint/unbound-method */
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

import { BadRequestException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { ApiResponseDto } from '@app/common/utils/api-response.dto';
import { MessagePatterns as MP } from '@app/common/interfaces';
import { ClientType } from '@app/common/enums';
import { CookieService } from '@app/common/services/cookie.service';
import { JwtAuthGuard } from '@app/common/guards/jwt-auth.guard';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  let controller: AuthController;
  let authClient: { send: jest.Mock };
  let cookieService: jest.Mocked<CookieService>;

  beforeEach(async () => {
    authClient = {
      send: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: 'AUTH_SERVICE',
          useValue: authClient,
        },
        {
          provide: CookieService,
          useValue: {
            setAccessToken: jest.fn(),
            setRefreshToken: jest.fn(),
            clearAuthCookies: jest.fn(),
          },
        },
        {
          provide: JwtAuthGuard,
          useValue: {
            canActivate: jest.fn(() => true),
          },
        },
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AuthController);
    cookieService = module.get(CookieService);
  });

  it('registers users through the auth service and wraps the result', async () => {
    authClient.send.mockReturnValue(of({ id: 1, email: 'jane@example.com' }));

    await expect(
      controller.register({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        password: 'Password123!',
      }),
    ).resolves.toEqual(ApiResponseDto.success({ id: 1, email: 'jane@example.com' }, 'user.create.success'));

    expect(authClient.send).toHaveBeenCalledWith(
      MP.AUTH_REGISTER,
      expect.objectContaining({ email: 'jane@example.com' }),
    );
  });

  it('stores access and refresh tokens in cookies for web logins', async () => {
    const response = {} as never;
    authClient.send.mockReturnValue(of({ accessToken: 'access', refreshToken: 'refresh' }));

    await expect(
      controller.login({ ip: '127.0.0.1' } as never, response, {
        email: 'jane@example.com',
        password: 'Password123!',
        deviceId: 'device-1',
        clientType: ClientType.WEB,
      }),
    ).resolves.toEqual(ApiResponseDto.success(null, 'auth.login.success'));

    expect(cookieService.setAccessToken).toHaveBeenCalledWith(response, 'access', 'device-1');
    expect(cookieService.setRefreshToken).toHaveBeenCalledWith(response, 'refresh', 'device-1');
  });

  it('returns raw tokens for non-web logins', async () => {
    authClient.send.mockReturnValue(of({ accessToken: 'access', refreshToken: 'refresh' }));

    await expect(
      controller.login({ ip: '127.0.0.1' } as never, {} as never, {
        email: 'jane@example.com',
        password: 'Password123!',
        deviceId: 'device-1',
        clientType: ClientType.MOBILE,
      }),
    ).resolves.toEqual(
      ApiResponseDto.success({ accessToken: 'access', refreshToken: 'refresh' }, 'auth.login.success'),
    );

    expect(cookieService.setAccessToken).not.toHaveBeenCalled();
    expect(cookieService.setRefreshToken).not.toHaveBeenCalled();
  });

  it('refreshes tokens from cookies for web clients', async () => {
    const response = {} as never;
    authClient.send.mockReturnValue(of({ accessToken: 'next-access', refreshToken: 'next-refresh' }));

    await expect(
      controller.refreshTokens(
        {
          cookies: {
            refreshToken_device_1: 'cookie-refresh',
          },
        } as never,
        response,
        {
          refreshToken: 'body-refresh-ignored',
          deviceId: 'device_1',
          clientType: ClientType.WEB,
        },
      ),
    ).resolves.toEqual(ApiResponseDto.success(null, 'auth.refresh.success'));

    expect(authClient.send).toHaveBeenCalledWith(
      MP.AUTH_REFRESH,
      expect.objectContaining({
        deviceId: 'device_1',
        refreshToken: 'cookie-refresh',
      }),
    );
    expect(cookieService.setAccessToken).toHaveBeenCalledWith(response, 'next-access', 'device_1');
    expect(cookieService.setRefreshToken).toHaveBeenCalledWith(response, 'next-refresh', 'device_1');
  });

  it('uses the body refresh token for mobile clients', async () => {
    authClient.send.mockReturnValue(of({ accessToken: 'next-access', refreshToken: 'next-refresh' }));

    await expect(
      controller.refreshTokens({ cookies: {} } as never, {} as never, {
        refreshToken: 'mobile-refresh',
        deviceId: 'device-1',
        clientType: ClientType.MOBILE,
      }),
    ).resolves.toEqual(
      ApiResponseDto.success({ accessToken: 'next-access', refreshToken: 'next-refresh' }, 'auth.refresh.success'),
    );
  });

  it('rejects refresh requests when no refresh token is available', async () => {
    await expect(
      controller.refreshTokens({ cookies: {} } as never, {} as never, {
        refreshToken: '',
        deviceId: 'device-1',
        clientType: ClientType.WEB,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('clears cookies on web logout', async () => {
    const response = {} as never;
    authClient.send.mockReturnValue(of(undefined));

    await expect(
      controller.logout(response, {
        userId: 42,
        deviceId: 'device-1',
        clientType: ClientType.WEB,
      }),
    ).resolves.toEqual(ApiResponseDto.success(null, 'auth.logout.success'));

    expect(cookieService.clearAuthCookies).toHaveBeenCalledWith(response, 'device-1');
  });

  it('returns the authenticated profile in the standard response shape', () => {
    expect(controller.getProfile({ id: 42, email: 'jane@example.com' })).toEqual(
      ApiResponseDto.success({ id: 42, email: 'jane@example.com' }, 'auth.profile.success'),
    );
  });

  it('translates RPC failures into HTTP exceptions with extracted status and message', async () => {
    authClient.send.mockReturnValue(
      throwError(() => ({
        response: {
          statusCode: 409,
          code: 'user.email.already_exists',
        },
      })),
    );

    let error: HttpException | undefined;

    try {
      await controller.register({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        password: 'Password123!',
      });
    } catch (caughtError) {
      error = caughtError as HttpException;
    }

    expect(error).toBeInstanceOf(HttpException);
    expect(error?.getStatus()).toBe(409);
    expect(error?.getResponse()).toEqual({
      code: 'user.email.already_exists',
      message: 'Email already exists',
    });
  });
});
