import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule, CommonModule, GlobalExceptionFilter, winstonLoggerConfig } from '@app/common';
import { WinstonModule } from 'nest-winston';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { NotificationService } from './notification-service.service';
import { NotificationEventsHandler } from './notification-events.handler';
import { LogNotificationSender, NOTIFICATION_SENDER } from './notification.sender';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { rabbitmqConfig } from './config/rabbitmq.config';
import { LoggingInterceptor } from '@app/common';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/notification-service/.env', '.env'],
    }),
    CommonModule,
    RabbitMQModule.forRoot(rabbitmqConfig),
    WinstonModule.forRoot(winstonLoggerConfig),
    HealthModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    NotificationService,
    NotificationEventsHandler,
    { provide: NOTIFICATION_SENDER, useClass: LogNotificationSender },
  ],
})
export class NotificationServiceModule {}
