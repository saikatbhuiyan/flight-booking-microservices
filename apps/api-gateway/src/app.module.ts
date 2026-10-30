import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthController } from './controllers/auth.controller';
import { FlightController } from './controllers/flight.controller';
import { BookingController } from './controllers/booking.controller';
import { CityController } from './controllers/city.controller';
import { AirportController } from './controllers/airport.controller';
import { AirplaneController } from './controllers/airplane.controller';
import { SeatController } from './controllers/seat.controller';
import { PaymentController } from './controllers/payment.controller';
import { RolesGuard } from './guards/roles.guard';
import {
  CookieService,
  RedisModule,
  CommonModule,
  RabbitMQHealthIndicator,
  RedisHealthIndicator,
  GlobalExceptionFilter,
  winstonLoggerConfig,
  LoggingInterceptor,
  JwtAuthGuard,
  resolveRabbitMqUrl,
  RPC_QUEUE_OPTIONS,
  RpcQueue,
} from '@app/common';
import { WinstonModule } from 'nest-winston';
import { TerminusModule } from '@nestjs/terminus';
import { GatewayHealthController } from './controllers/health.controller';
import authConfig from '@app/common/config/auth.config';
import { RateLimiterModule } from '@app/rate-limiter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [authConfig],
      envFilePath: ['apps/api-gateway/.env', '.env'],
    }),
    RedisModule,
    RateLimiterModule,
    CommonModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_ACCESS_EXPIRATION') as any,
        },
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    ClientsModule.registerAsync([
      {
        name: 'AUTH_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [resolveRabbitMqUrl(configService.get<string>('RABBITMQ_URL'))],
            queue: RpcQueue.AUTH,
            queueOptions: RPC_QUEUE_OPTIONS,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'FLIGHT_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [resolveRabbitMqUrl(configService.get<string>('RABBITMQ_URL'))],
            queue: RpcQueue.FLIGHT,
            queueOptions: RPC_QUEUE_OPTIONS,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'PAYMENT_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [resolveRabbitMqUrl(configService.get<string>('RABBITMQ_URL'))],
            queue: RpcQueue.PAYMENT,
            queueOptions: RPC_QUEUE_OPTIONS,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'BOOKING_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [resolveRabbitMqUrl(configService.get<string>('RABBITMQ_URL'))],
            queue: RpcQueue.BOOKING,
            queueOptions: RPC_QUEUE_OPTIONS,
          },
        }),
        inject: [ConfigService],
      },
    ]),
    WinstonModule.forRoot(winstonLoggerConfig),
    TerminusModule,
  ],
  controllers: [
    AuthController,
    FlightController,
    BookingController,
    CityController,
    AirportController,
    AirplaneController,
    SeatController,
    PaymentController,
    GatewayHealthController,
  ],
  providers: [
    CookieService,
    RabbitMQHealthIndicator,
    RedisHealthIndicator,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
