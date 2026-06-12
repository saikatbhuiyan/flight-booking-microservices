import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { MessagePatterns as MP } from '../interfaces';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
    private configService: ConfigService,
    @Inject('AUTH_SERVICE') private authClient: ClientProxy,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const type = context.getType();
    if (type === 'http') {
      const request = context.switchToHttp().getRequest();
      const token = this.extractTokenFromHeader(request);

      if (!token) {
        throw new UnauthorizedException('Token not found');
      }

      try {
        const payload = await this.jwtService.verifyAsync(token, {
          secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        });

        // Validate user with auth service
        const user = await firstValueFrom(this.authClient.send(MP.AUTH_VALIDATE, payload));

        request['user'] = user;
      } catch {
        throw new UnauthorizedException('Invalid token');
      }
    } else if (type === 'rpc') {
      // For RPC, we expect the token to be in the data payload
      const data = context.switchToRpc().getData();
      const token = data?.token || data?.accessToken;

      if (!token) {
        throw new UnauthorizedException('Token not found in RPC payload');
      }

      try {
        const payload = await this.jwtService.verifyAsync(token, {
          secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        });

        const user = await firstValueFrom(this.authClient.send(MP.AUTH_VALIDATE, payload));

        // Attach user to data for potential downstream use
        data.user = user;
      } catch {
        throw new UnauthorizedException('Invalid token in RPC payload');
      }
    }

    return true;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    // 1. Check Authorization Header
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type === 'Bearer') {
      return token;
    }

    // 2. Check Cookies (for Swagger/Web clients)
    if (request.cookies) {
      const accessTokenKey = Object.keys(request.cookies).find((key) => key.startsWith('accessToken_'));
      if (accessTokenKey) {
        return request.cookies[accessTokenKey];
      }
    }

    return undefined;
  }
}
