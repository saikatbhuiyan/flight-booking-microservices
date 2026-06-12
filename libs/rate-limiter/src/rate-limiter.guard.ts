import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimiterService } from './rate-limiter.service';
import { RateLimitConfig } from './interfaces/rate-limiter.interface';
import { RATE_LIMIT_KEY } from './decorators/rate-limit.decorator';
import { Request, Response } from 'express';

@Injectable()
export class RateLimiterGuard implements CanActivate {
  private readonly logger = new Logger(RateLimiterGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiterService: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if rate limiting should be skipped
    const skipRateLimit = this.reflector.getAllAndOverride<boolean>('skipRateLimit', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipRateLimit) {
      this.logger.debug('Rate limiting skipped');
      return true;
    }

    // Get rate limit config from method or class decorator (method takes precedence)
    const config = this.reflector.getAllAndOverride<RateLimitConfig>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Generate rate limit key
    const key = this.generateKey(request);

    this.logger.debug(`Checking rate limit for key: ${key}`);

    // Check rate limit
    const result = await this.rateLimiterService.consume(key, config);

    // Set standard rate limit headers
    response.setHeader('X-RateLimit-Limit', result.info.limit.toString());
    response.setHeader('X-RateLimit-Remaining', result.info.remaining.toString());
    response.setHeader('X-RateLimit-Reset', result.info.reset.toString());

    if (!result.allowed) {
      if (result.info.retryAfter) {
        response.setHeader('Retry-After', result.info.retryAfter.toString());
      }

      this.logger.warn(`Rate limit exceeded for key: ${key}`);

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests, please try again later',
          error: 'Rate Limit Exceeded',
          retryAfter: result.info.retryAfter,
          limit: result.info.limit,
          reset: result.info.reset,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Generate unique rate limit key based on request context
   * Priority: user ID > API key > IP address
   */
  private generateKey(request: any): string {
    let identifier: string;
    let identifierType: string;

    // 1. Try to use authenticated user ID
    if (request.user?.id) {
      identifier = request.user.id.toString();
      identifierType = 'user';
    }
    // 2. Try to use API key from header
    else if (request.headers['x-api-key']) {
      identifier = request.headers['x-api-key'];
      identifierType = 'api';
    }
    // 3. Fallback to IP address
    else {
      identifier = this.extractIp(request);
      identifierType = 'ip';
    }

    // Add route path for endpoint-specific limiting
    const method = request.method;
    const path = request.route?.path || request.url.split('?')[0];
    const route = `${method}:${path}`;

    return `${identifierType}:${identifier}:${route}`;
  }

  /**
   * Extract IP address from request, handling proxies
   */
  private extractIp(request: any): string {
    // Check for proxied IP addresses
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
      // x-forwarded-for can contain multiple IPs, take the first one
      return forwardedFor.split(',')[0].trim();
    }

    const realIp = request.headers['x-real-ip'];
    if (realIp) {
      return realIp;
    }

    // Fallback to connection remote address
    return request.ip || request.connection?.remoteAddress || 'unknown';
  }
}
