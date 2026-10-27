/* eslint-disable @typescript-eslint/unbound-method */
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@app/common/enums';
import { SignInDto, SignUpDto } from '@app/common/dto';
import { InvalidateRefreshTokenError } from '@app/common/errors';
import { Repository } from 'typeorm';
import { AuthenticationService } from './authentication.service';
import { RefreshTokenIdsStorage } from './refresh-token-ids.storage';
import { RefreshTokenBlacklist } from './refresh-token-black-list.storage';
import { AuthAuditService } from './auth-audit.service';
import { HashingService } from '../hashing/hashing.service';
import { User } from '../entities/user.entity';

describe('AuthenticationService', () => {
  let service: AuthenticationService;
  let usersRepository: jest.Mocked<Repository<User>>;
  let hashingService: jest.Mocked<HashingService>;
  let jwtService: jest.Mocked<JwtService>;
  let refreshTokenIdsStorage: jest.Mocked<RefreshTokenIdsStorage>;
  let refreshTokenBlacklist: jest.Mocked<RefreshTokenBlacklist>;
  let auditService: jest.Mocked<AuthAuditService>;

  const configValues: Record<string, string | number> = {
    'jwt.secret': 'access-secret',
    'jwt.accessTokenTtl': 900,
    'jwt.refreshSecret': 'refresh-secret',
    'jwt.refreshTokenTtl': 604800,
    'jwt.tokenAudience': 'flight-bookings',
    'jwt.tokenIssuer': 'auth-service',
  };

  const createUser = (overrides: Partial<User> = {}): User => ({
    id: 42,
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    password: 'hashed-password',
    googleId: undefined,
    lastLoginAt: undefined,
    lastLoginIp: undefined,
    role: Role.USER,
    isActive: true,
    isLocked: false,
    notificationSettings: undefined,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthenticationService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
            findOneBy: jest.fn(),
            findOneByOrFail: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: HashingService,
          useValue: {
            hash: jest.fn(),
            compare: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn(),
            verifyAsync: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => configValues[key]),
          },
        },
        {
          provide: RefreshTokenIdsStorage,
          useValue: {
            insert: jest.fn(),
            validate: jest.fn(),
            invalidate: jest.fn(),
            getToken: jest.fn(),
          },
        },
        {
          provide: RefreshTokenBlacklist,
          useValue: {
            isBlacklisted: jest.fn(),
            blacklistToken: jest.fn(),
          },
        },
        {
          provide: AuthAuditService,
          useValue: {
            logSignInAttempt: jest.fn(),
            logTokenGeneration: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AuthenticationService);
    usersRepository = module.get(getRepositoryToken(User));
    hashingService = module.get(HashingService);
    jwtService = module.get(JwtService);
    refreshTokenIdsStorage = module.get(RefreshTokenIdsStorage);
    refreshTokenBlacklist = module.get(RefreshTokenBlacklist);
    auditService = module.get(AuthAuditService);
  });

  describe('register', () => {
    it('creates a user with a hashed password and returns a sanitized profile', async () => {
      const dto: SignUpDto = {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        password: 'Password123!',
      };
      const createdUser = createUser({ ...dto });
      const savedUser = createUser(dto);

      usersRepository.findOne.mockResolvedValue(null);
      usersRepository.create.mockReturnValue(createdUser);
      hashingService.hash.mockResolvedValue('hashed-password');
      usersRepository.save.mockResolvedValue(savedUser);

      await expect(service.register(dto)).resolves.toEqual({
        id: 42,
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      expect(hashingService.hash).toHaveBeenCalledWith('Password123!');
      expect(usersRepository.create).toHaveBeenCalledWith({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        role: Role.USER,
      });
      expect(usersRepository.save).toHaveBeenCalledWith(expect.objectContaining({ password: 'hashed-password' }));
    });

    it('ignores privileged fields smuggled into the payload', async () => {
      const dto = {
        firstName: 'Mallory',
        email: 'mallory@example.com',
        password: 'Password123!',
        role: Role.ADMIN,
        isActive: true,
      } as SignUpDto;
      usersRepository.findOne.mockResolvedValue(null);
      usersRepository.create.mockReturnValue(createUser({ email: dto.email }));
      hashingService.hash.mockResolvedValue('hashed-password');

      await service.register(dto);

      expect(usersRepository.create).toHaveBeenCalledWith(expect.objectContaining({ role: Role.USER }));
      expect(usersRepository.create).toHaveBeenCalledWith(expect.not.objectContaining({ isActive: expect.anything() }));
    });

    it('rejects duplicate registrations', async () => {
      usersRepository.findOne.mockResolvedValue(createUser());

      await expect(
        service.register({
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          password: 'Password123!',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('signIn', () => {
    const signInDto: SignInDto = {
      email: 'jane@example.com',
      password: 'Password123!',
      deviceId: 'device-1',
      clientType: undefined,
    };

    it('rejects unknown users', async () => {
      usersRepository.findOneBy.mockResolvedValue(null);

      await expect(service.signIn(signInDto, '127.0.0.1')).rejects.toThrow(UnauthorizedException);
    });

    it('logs failed password attempts and rejects invalid credentials', async () => {
      usersRepository.findOneBy.mockResolvedValue(createUser());
      hashingService.compare.mockResolvedValue(false);

      await expect(service.signIn(signInDto, '127.0.0.1')).rejects.toThrow('Invalid credentials');

      expect(auditService.logSignInAttempt).toHaveBeenCalledWith(null, '127.0.0.1', 'device-1', false);
    });

    it('returns tokens and logs successful sign-in attempts', async () => {
      usersRepository.findOneBy.mockResolvedValue(createUser());
      hashingService.compare.mockResolvedValue(true);
      jwtService.signAsync.mockResolvedValueOnce('access-token').mockResolvedValueOnce('refresh-token');

      await expect(service.signIn(signInDto, '127.0.0.1')).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });

      expect(refreshTokenIdsStorage.insert).toHaveBeenCalledWith(42, expect.any(String), 'device-1');
      expect(auditService.logTokenGeneration).toHaveBeenCalledWith(42, 'device-1', expect.any(String), '127.0.0.1');
      expect(auditService.logSignInAttempt).toHaveBeenCalledWith(42, '127.0.0.1', 'device-1', true);
    });
  });

  describe('generateTokens', () => {
    it('signs access and refresh tokens with the expected claims and settings', async () => {
      jwtService.signAsync.mockResolvedValueOnce('access-token').mockResolvedValueOnce('refresh-token');

      await expect(service.generateTokens(createUser(), 'device-1', '10.0.0.1')).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });

      expect(jwtService.signAsync).toHaveBeenNthCalledWith(
        1,
        { id: 42, email: 'jane@example.com' },
        { secret: 'access-secret', expiresIn: 900 },
      );
      expect(jwtService.signAsync).toHaveBeenNthCalledWith(
        2,
        {
          sub: 42,
          email: 'jane@example.com',
          refreshTokenId: expect.any(String),
          deviceId: 'device-1',
        },
        {
          secret: 'refresh-secret',
          expiresIn: 604800,
          audience: 'flight-bookings',
          issuer: 'auth-service',
        },
      );
    });
  });

  describe('refreshTokens', () => {
    it('rotates refresh tokens for valid requests', async () => {
      const user = createUser();
      const nextTokens = { accessToken: 'next-access', refreshToken: 'next-refresh' };

      jwtService.verifyAsync.mockResolvedValue({
        sub: 42,
        email: 'jane@example.com',
        refreshTokenId: 'rt-1',
        deviceId: 'device-1',
      });
      refreshTokenBlacklist.isBlacklisted.mockResolvedValue(false);
      usersRepository.findOneByOrFail.mockResolvedValue(user);
      refreshTokenIdsStorage.validate.mockResolvedValue(true);
      jest.spyOn(service, 'generateTokens').mockResolvedValue(nextTokens);

      await expect(
        service.refreshTokens({
          refreshToken: 'refresh-token',
          deviceId: 'device-1',
          clientType: undefined,
        }),
      ).resolves.toEqual(nextTokens);

      expect(refreshTokenIdsStorage.invalidate).toHaveBeenCalledWith(42, 'device-1');
      expect(refreshTokenBlacklist.blacklistToken).toHaveBeenCalledWith('rt-1');
      expect(service.generateTokens).toHaveBeenCalledWith(user, 'device-1');
    });

    it('rejects refresh tokens presented from a different device', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 42,
        email: 'jane@example.com',
        refreshTokenId: 'rt-1',
        deviceId: 'device-2',
      });

      await expect(
        service.refreshTokens({
          refreshToken: 'refresh-token',
          deviceId: 'device-1',
          clientType: undefined,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects revoked refresh tokens', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 42,
        email: 'jane@example.com',
        refreshTokenId: 'rt-1',
        deviceId: 'device-1',
      });
      refreshTokenBlacklist.isBlacklisted.mockResolvedValue(true);

      await expect(
        service.refreshTokens({
          refreshToken: 'refresh-token',
          deviceId: 'device-1',
          clientType: undefined,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('translates storage mismatches into invalid refresh token errors', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 42,
        email: 'jane@example.com',
        refreshTokenId: 'rt-1',
        deviceId: 'device-1',
      });
      refreshTokenBlacklist.isBlacklisted.mockResolvedValue(false);
      usersRepository.findOneByOrFail.mockResolvedValue(createUser());
      refreshTokenIdsStorage.validate.mockRejectedValue(new InvalidateRefreshTokenError());

      await expect(
        service.refreshTokens({
          refreshToken: 'refresh-token',
          deviceId: 'device-1',
          clientType: undefined,
        }),
      ).rejects.toThrow('Invalid refresh token');
    });
  });

  describe('signOut', () => {
    it('invalidates the stored refresh token and blacklists it', async () => {
      refreshTokenIdsStorage.getToken.mockResolvedValue('rt-1');

      await expect(
        service.signOut({
          userId: 42,
          deviceId: 'device-1',
          clientType: undefined,
        }),
      ).resolves.toBeUndefined();

      expect(refreshTokenIdsStorage.invalidate).toHaveBeenCalledWith(42, 'device-1');
      expect(refreshTokenBlacklist.blacklistToken).toHaveBeenCalledWith('rt-1');
    });
  });

  describe('validateUser', () => {
    it('returns the active user profile with the role stored on the user', async () => {
      usersRepository.findOne.mockResolvedValue(createUser({ role: Role.ADMIN }));

      await expect(service.validateUser({ id: 42, email: 'jane@example.com' })).resolves.toEqual({
        id: 42,
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        role: Role.ADMIN,
      });
    });

    it('rejects token payloads without a user id instead of matching on email alone', async () => {
      await expect(service.validateUser({ email: 'jane@example.com' })).rejects.toThrow(UnauthorizedException);
      expect(usersRepository.findOne).not.toHaveBeenCalled();
    });

    it('rejects inactive users', async () => {
      usersRepository.findOne.mockResolvedValue(createUser({ isActive: false }));

      await expect(service.validateUser({ id: 42, email: 'jane@example.com' })).rejects.toThrow(UnauthorizedException);
    });
  });
});
