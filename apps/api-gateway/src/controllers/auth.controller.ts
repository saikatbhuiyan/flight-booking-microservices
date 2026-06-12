import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Inject,
  Res,
  Req,
  UseGuards,
  Get,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  MessagePatterns as MP,
  ApiResponseDto,
  Public,
  CurrentUser,
  ClientType,
  CookieService,
  JwtAuthGuard,
  createHttpExceptionFromRpcError,
} from '@app/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SignUpDto as RegisterDto, SignInDto, RefreshTokenDto, SignOutDto } from '@app/common';
import { RateLimit } from '@app/rate-limiter';

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@ApiTags('Authentication')
@RateLimit({ points: 5, duration: 60 })
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    @Inject('AUTH_SERVICE') private readonly authClient: ClientProxy,
    private readonly cookieService: CookieService,
  ) {}

  // --- REGISTER ---------------------------------------------------
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'User registered successfully',
    type: ApiResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input' })
  async register(@Body() registerDto: RegisterDto) {
    const result = await this.callService(MP.AUTH_REGISTER, registerDto);
    return ApiResponseDto.success(result, 'user.create.success');
  }

  // --- LOGIN ------------------------------------------------------
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Login successful',
    type: ApiResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid credentials',
  })
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() loginDto: SignInDto) {
    const { clientType = ClientType.WEB, deviceId } = loginDto;

    const result = await this.callAuthService(MP.AUTH_LOGIN, {
      ...loginDto,
      ip: req.ip,
    });

    if (clientType === ClientType.WEB) {
      this.cookieService.setAccessToken(res, result.accessToken, deviceId);
      this.cookieService.setRefreshToken(res, result.refreshToken, deviceId);
      return ApiResponseDto.success(null, 'auth.login.success');
    }

    return ApiResponseDto.success(result, 'auth.login.success');
  }

  // --- REFRESH TOKEN ---------------------------------------------
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Token refreshed successfully',
    type: ApiResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Missing or invalid refresh token',
  })
  async refreshTokens(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() refreshTokenDto: RefreshTokenDto,
  ) {
    const { clientType = ClientType.WEB, deviceId } = refreshTokenDto;

    const refreshToken =
      clientType === ClientType.WEB ? req.cookies[`refreshToken_${deviceId}`] : refreshTokenDto.refreshToken;

    if (!refreshToken) {
      throw new BadRequestException({
        code: 'auth.token.missing',
      });
    }

    const result = await this.callAuthService(MP.AUTH_REFRESH, {
      ...refreshTokenDto,
      refreshToken,
    });

    if (clientType === ClientType.WEB) {
      this.cookieService.setAccessToken(res, result.accessToken, deviceId);
      this.cookieService.setRefreshToken(res, result.refreshToken, deviceId);
      return ApiResponseDto.success(null, 'auth.refresh.success');
    }

    return ApiResponseDto.success(result, 'auth.refresh.success');
  }

  // --- SIGN OUT ---------------------------------------------------
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout user' })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Logged out successfully',
    type: ApiResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async logout(@Res({ passthrough: true }) res: Response, @Body() payload: SignOutDto) {
    const { clientType = ClientType.WEB, deviceId } = payload;
    await this.callService(MP.AUTH_SIGNOUT, payload);

    if (clientType === ClientType.WEB) {
      this.cookieService.clearAuthCookies(res, deviceId);
    }

    return ApiResponseDto.success(null, 'auth.logout.success');
  }

  // --- CURRENT USER ----------------------------------------------
  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Profile retrieved successfully',
    type: ApiResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  getProfile(@CurrentUser() user: any) {
    return ApiResponseDto.success(user, 'auth.profile.success');
  }

  // --- Helper -----------------------------------------------------
  private async callService<TResult, TInput>(pattern: string, data: TInput): Promise<TResult> {
    try {
      return await firstValueFrom(this.authClient.send<TResult>(pattern, data));
    } catch (error) {
      this.logger.error(`Error calling ${pattern}`, JSON.stringify(error, null, 2));
      throw createHttpExceptionFromRpcError(error);
    }
  }

  private async callAuthService<TResult extends AuthTokens, TInput>(pattern: string, data: TInput): Promise<TResult> {
    return this.callService<TResult, TInput>(pattern, data);
  }
}
