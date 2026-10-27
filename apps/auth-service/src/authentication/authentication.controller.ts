import { Controller, Logger, UseFilters, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthenticationService } from './authentication.service';
import { SignInMessageDto } from './dto/sign-in-message.dto';
import {
  MessagePatterns as MP,
  RefreshTokenDto,
  SignOutDto,
  SignUpDto,
  CommonRpcExceptionFilter,
  RpcValidationPipe,
} from '@app/common';

/**
 * RabbitMQ handlers for authentication. Clients reach these through the API gateway only.
 */
@Controller()
@UseFilters(CommonRpcExceptionFilter)
@UsePipes(RpcValidationPipe)
export class AuthMessageController {
  private readonly logger = new Logger(AuthMessageController.name);

  constructor(private readonly authService: AuthenticationService) {}

  @MessagePattern(MP.AUTH_REGISTER)
  register(@Payload() data: SignUpDto) {
    this.logger.debug(`RMQ: Registering ${data.email}`);
    return this.authService.register(data);
  }

  @MessagePattern(MP.AUTH_LOGIN)
  login(@Payload() data: SignInMessageDto) {
    this.logger.debug(`RMQ: Logging in ${data.email}`);
    const { ip, ...credentials } = data;
    return this.authService.signIn(credentials, ip);
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
