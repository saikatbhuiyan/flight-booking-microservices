import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationServiceModule } from './notification-service.module';
import { CommonRpcExceptionFilter, RmqSetup, resolveRabbitMqUrl } from '@app/common';

async function bootstrap() {
  const logger = new Logger('NotificationService');
  const app = await NestFactory.create(NotificationServiceModule);
  const configService = app.get(ConfigService);
  app.enableShutdownHooks();

  // Global prefix for HTTP routes
  app.setGlobalPrefix('api/v1');

  const rabbitmqUrl = resolveRabbitMqUrl(configService.get<string>('RABBITMQ_URL'));
  const queue = 'notification_queue';

  // Automatically create queues for this service
  await RmqSetup.setupQueues(configService, 'notification', 10000, 1);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [rabbitmqUrl],
      queue,
      queueOptions: {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': `${queue}_retry`,
          'x-max-length': 10000,
        },
      },
      prefetchCount: 1,
      noAck: true,
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new CommonRpcExceptionFilter());

  await app.startAllMicroservices();
  logger.log(`Notification Service is running and listening to queue: ${queue}`);

  const port = configService.get<number>('PORT') || 3004;
  await app.listen(port);
  logger.log(`Notification Service HTTP server is running on port: ${port}`);
}

void bootstrap();
