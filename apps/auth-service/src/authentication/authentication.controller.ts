import { Controller, Logger, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthenticationService } from './authentication.service';
import {
  MessagePatterns as MP,
  RefreshTokenDto,
  SignInDto,
  SignOutDto,
  SignUpDto,
  CommonRpcExceptionFilter,
} from '@app/common';

/**
 * RabbitMQ handlers for authentication. Clients reach these through the API gateway only.
 */
@Controller()
@UseFilters(CommonRpcExceptionFilter)
export class AuthMessageController {
  private readonly logger = new Logger(AuthMessageController.name);

  constructor(private readonly authService: AuthenticationService) {}

  @MessagePattern(MP.AUTH_REGISTER)
  register(@Payload() data: SignUpDto) {
    this.logger.debug(`RMQ: Registering ${data.email}`);
    return this.authService.register(data);
  }

  @MessagePattern(MP.AUTH_LOGIN)
  login(@Payload() data: SignInDto) {
    this.logger.debug(`RMQ: Logging in ${data.email}`);
    return this.authService.signIn(data);
  }

  @MessagePattern(MP.AUTH_REFRESH)
  refresh(@Payload() data: RefreshTokenDto) {
    return this.authService.refreshTokens(data);
  }

  @MessagePattern(MP.AUTH_SIGNOUT)
  signOut(@Payload() data: SignOutDto) {
    return this.authService.signOut(data);
  }

  @MessagePattern(MP.AUTH_VALIDATE)
  validateUser(@Payload() data: any) {
    return this.authService.validateUser(data);
  }
}
