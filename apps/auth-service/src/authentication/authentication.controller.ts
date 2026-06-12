import { Controller, Logger, Post, HttpCode, HttpStatus, Req, UseFilters } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, RmqContext } from '@nestjs/microservices';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticationService } from './authentication.service';
import {
  MessagePatterns as MP,
  RefreshTokenDto,
  RmqHelper,
  SignInDto,
  SignOutDto,
  SignUpDto,
  ApiResponseDto,
  Public,
  CommonRpcExceptionFilter,
} from '@app/common';
import { Request } from 'express';

@ApiTags('Authentication')
@Controller('auth')
@UseFilters(CommonRpcExceptionFilter)
export class AuthMessageController {
  private readonly logger = new Logger(AuthMessageController.name);

  constructor(private readonly authService: AuthenticationService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @MessagePattern(MP.AUTH_REGISTER)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'User registered successfully',
    type: ApiResponseDto,
  })
  async register(@Payload() data: SignUpDto, @Ctx() context?: RmqContext) {
    if (context && typeof context.getChannelRef === 'function') {
      return RmqHelper.handleAck(context, async () => {
        this.logger.debug(`RMQ: Registering ${data.email}`);
        return this.authService.register(data);
      });
    }
    this.logger.debug(`HTTP: Registering ${data.email}`);
    const result = await this.authService.register(data);
    return ApiResponseDto.success(result, 'user.create.success');
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @MessagePattern(MP.AUTH_LOGIN)
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Login successful',
    type: ApiResponseDto,
  })
  login(@Payload() data: SignInDto, @Req() req?: Request, @Ctx() context?: RmqContext) {
    if (context && typeof context.getChannelRef === 'function') {
      return RmqHelper.handleAck(context, async () => {
        this.logger.debug(`RMQ: Logging in ${data.email}`);
        return this.authService.signIn(data);
      });
    }
    this.logger.debug(`HTTP: Logging in ${data.email}`);
    return this.authService.signIn(data, req?.ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @MessagePattern(MP.AUTH_REFRESH)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Token refreshed successfully',
    type: ApiResponseDto,
  })
  async refresh(@Payload() data: RefreshTokenDto, @Ctx() context?: RmqContext) {
    if (context && typeof context.getChannelRef === 'function') {
      return RmqHelper.handleAck(context, async () => {
        return this.authService.refreshTokens(data);
      });
    }
    const result = await this.authService.refreshTokens(data);
    return ApiResponseDto.success(result, 'auth.refresh.success');
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @MessagePattern(MP.AUTH_SIGNOUT)
  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Logged out successfully',
    type: ApiResponseDto,
  })
  signOut(@Payload() data: SignOutDto, @Ctx() context?: RmqContext) {
    if (context && typeof context.getChannelRef === 'function') {
      return RmqHelper.handleAck(context, async () => {
        return this.authService.signOut(data);
      });
    }
    return this.authService.signOut(data);
  }

  @MessagePattern(MP.AUTH_VALIDATE)
  validateUser(@Payload() data: any, @Ctx() context: RmqContext) {
    return RmqHelper.handleAck(context, async () => {
      return this.authService.validateUser(data);
    });
  }
}
