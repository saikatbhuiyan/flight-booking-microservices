import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  HealthModule,
  CommonModule,
  GlobalExceptionFilter,
  winstonLoggerConfig,
  resolveRabbitMqUrl,
  RPC_QUEUE_OPTIONS,
  RpcQueue,
} from '@app/common';
import { WinstonModule } from 'nest-winston';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { NotificationService } from './notification-service.service';
import { NotificationEventsHandler } from './notification-events.handler';
import { LogNotificationSender, NOTIFICATION_SENDER, SesNotificationSender } from './notification.sender';
import { AUTH_CLIENT, RecipientDirectory } from './recipient.directory';
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
    ClientsModule.registerAsync([
      {
        name: AUTH_CLIENT,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [resolveRabbitMqUrl(configService.get<string>('RABBITMQ_URL'))],
            queue: RpcQueue.AUTH,
            queueOptions: RPC_QUEUE_OPTIONS,
          },
        }),
      },
    ]),
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
    RecipientDirectory,
    {
      provide: NOTIFICATION_SENDER,
      inject: [ConfigService, RecipientDirectory],
      useFactory: (config: ConfigService, recipients: RecipientDirectory) =>
        config.get<string>('NOTIFICATION_PROVIDER') === 'ses'
          ? new SesNotificationSender(
              {
                from: config.getOrThrow<string>('NOTIFICATION_FROM_EMAIL'),
                region: config.get<string>('AWS_REGION') || 'us-east-1',
                endpoint: config.get<string>('AWS_ENDPOINT'),
              },
              recipients,
            )
          : new LogNotificationSender(),
    },
  ],
})
export class NotificationServiceModule {}
