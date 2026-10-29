import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HashingService } from '../hashing/hashing.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { RefreshTokenIdsStorage } from './refresh-token-ids.storage';
import { RefreshTokenBlacklist } from './refresh-token-black-list.storage';
import { AuthAuditService } from './auth-audit.service';
import { SignInDto, SignOutDto, RefreshTokenDto, SignUpDto } from '@app/common';
import { Role, InvalidateRefreshTokenError, UserContact } from '@app/common';
import { User } from '../entities/user.entity';
import { JwtSignOptions, JwtVerifyOptions } from '@nestjs/jwt';

@Injectable()
export class AuthenticationService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly hashingService: HashingService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly refreshTokenIdsStorage: RefreshTokenIdsStorage,
    private readonly refreshTokenBlacklist: RefreshTokenBlacklist,
    private readonly auditService: AuthAuditService,
  ) {}

  async register(registerDto: SignUpDto) {
    const existingUser = await this.usersRepository.findOne({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      const exception = new ConflictException('User already exists');
      (exception as Error & { code?: string }).code = 'user.email.already_exists';
      throw exception;
    }

    // Explicit fields: the RMQ payload is not validated, so never let it set role/isActive/isLocked.
    const user = this.usersRepository.create({
      firstName: registerDto.firstName,
      lastName: registerDto.lastName,
      email: registerDto.email,
      role: Role.USER,
    });
    user.password = await this.hashingService.hash(registerDto.password);
    await this.usersRepository.save(user);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }

  /**
   * Sign in user with password validation
   */
  async signIn(signInDto: SignInDto, ip?: string) {
    const { email, password, deviceId } = signInDto;
    const user = await this.usersRepository.findOneBy({ email });
    if (!user) {
      throw this.createUnauthorizedException('Invalid credentials', 'auth.invalid_credentials');
    }

    // Password validation
    if (user.password) {
      const isValid = await this.hashingService.compare(password, user.password);
      if (!isValid) {
        await this.auditService.logSignInAttempt(null, ip, deviceId, false);
        throw this.createUnauthorizedException('Invalid credentials', 'auth.invalid_credentials');
      }
    }

    const tokens = await this.generateTokens(user, deviceId, ip);

    await this.auditService.logSignInAttempt(user.id, ip, deviceId, true);
    return tokens;
  }

  /**
   * Generate access + refresh tokens (per-device)
   */
  async generateTokens(user: User, deviceId: string, ip?: string) {
    const refreshTokenId = randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        // No role claim: roles are resolved from the database in validateUser on every request.
        { id: user.id, email: user.email },
        {
          secret: this.configService.get<string>('jwt.secret'),
          expiresIn: this.configService.get<number>('jwt.accessTokenTtl'),
        },
      ),
      this.jwtService.signAsync(
        {
          sub: user.id,
          email: user.email,
          refreshTokenId,
          deviceId,
        },
        this.getRefreshTokenSignOptions(),
      ),
    ]);

    // Store refresh token in Redis (per-device)
    await this.refreshTokenIdsStorage.insert(user.id, refreshTokenId, deviceId);

    // Audit log
    await this.auditService.logTokenGeneration(user.id, deviceId, refreshTokenId, ip);

    return { accessToken, refreshToken };
  }

  /**
   * Refresh tokens (per-device rotation + blacklist)
   */
  async refreshTokens(refreshTokenDto: RefreshTokenDto) {
    const { refreshToken, deviceId } = refreshTokenDto;

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: number;
        email: string;
        refreshTokenId: string;
        deviceId: string;
      }>(refreshToken, this.getRefreshTokenVerifyOptions());

      if (deviceId && payload.deviceId !== deviceId) {
        throw this.createUnauthorizedException('Unauthorized', 'auth.unauthorized');
      }

      const effectiveDeviceId = deviceId || payload.deviceId;

      // Check if token is blacklisted
      if (await this.refreshTokenBlacklist.isBlacklisted(payload.refreshTokenId)) {
        throw this.createUnauthorizedException('Unauthorized', 'auth.unauthorized');
      }

      // Validate token in Redis (per-device)
      const user = await this.usersRepository.findOneByOrFail({
        id: payload.sub,
      });
      const isValid = await this.refreshTokenIdsStorage.validate(user.id, payload.refreshTokenId, effectiveDeviceId);
      if (!isValid) throw new InvalidateRefreshTokenError();

      // Invalidate old refresh token
      await this.refreshTokenIdsStorage.invalidate(user.id, effectiveDeviceId);
      await this.refreshTokenBlacklist.blacklistToken(payload.refreshTokenId);

      // Generate new tokens
      return this.generateTokens(user, effectiveDeviceId);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      if (error instanceof InvalidateRefreshTokenError) {
        throw this.createUnauthorizedException('Invalid refresh token', 'auth.invalid_refresh_token');
      }
      throw this.createUnauthorizedException('Unauthorized', 'auth.unauthorized');
    }
  }

  /**
   * Sign out (per-device)
   */
  async signOut(signOutDto: SignOutDto) {
    const { userId, deviceId } = signOutDto;
    const refreshTokenId = await this.refreshTokenIdsStorage.getToken(userId, deviceId);
    await this.refreshTokenIdsStorage.invalidate(userId, deviceId);
    // Optional: blacklist the current refresh token to prevent reuse
    await this.refreshTokenBlacklist.blacklistToken(refreshTokenId);
  }

  /**
   * Validate user for JWT guard
   */
  async validateUser(payload: any) {
    // TypeORM drops undefined where-values, so a missing id would otherwise match on email alone.
    if (!payload?.id) {
      throw this.createUnauthorizedException('Unauthorized', 'auth.unauthorized');
    }

    const user = await this.usersRepository.findOne({
      where: { id: payload.id, email: payload.email },
    });

    if (!user || !user.isActive) {
      throw this.createUnauthorizedException('Unauthorized', 'auth.unauthorized');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    };
  }

  /** Contact details for other services (notifications). Never exposes credentials. */
  async getContact(id: number): Promise<UserContact> {
    const user = await this.usersRepository.findOne({ where: { id }, relations: { notificationSettings: true } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      emailEnabled: user.notificationSettings?.emailEnabled ?? true,
    };
  }

  private getRefreshTokenSignOptions(): JwtSignOptions {
    const tokenAudience = this.configService.get<string>('jwt.tokenAudience');
    const tokenIssuer = this.configService.get<string>('jwt.tokenIssuer');

    return {
      secret: this.configService.get<string>('jwt.refreshSecret'),
      expiresIn: this.configService.get<number>('jwt.refreshTokenTtl'),
      ...(tokenAudience ? { audience: tokenAudience } : {}),
      ...(tokenIssuer ? { issuer: tokenIssuer } : {}),
    };
  }

  private getRefreshTokenVerifyOptions(): JwtVerifyOptions {
    const tokenAudience = this.configService.get<string>('jwt.tokenAudience');
    const tokenIssuer = this.configService.get<string>('jwt.tokenIssuer');

    return {
      secret: this.configService.get<string>('jwt.refreshSecret'),
      ...(tokenAudience ? { audience: tokenAudience } : {}),
      ...(tokenIssuer ? { issuer: tokenIssuer } : {}),
    };
  }

  private createUnauthorizedException(message: string, code: string): UnauthorizedException {
    const exception = new UnauthorizedException(message);
    (exception as Error & { code?: string }).code = code;
    return exception;
  }
}
