import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingServiceModule } from './booking-service.module';
import { CommonRpcExceptionFilter, RmqSetup, resolveRabbitMqUrl } from '@app/common';
import { initializeTracing } from '@app/telemetry';

async function bootstrap() {
  const logger = new Logger('BookingService');
  const app = await NestFactory.create(BookingServiceModule);
  const configService = app.get(ConfigService);
  app.enableShutdownHooks();

  initializeTracing('booking-service');

  // Global prefix for HTTP routes
  app.setGlobalPrefix('api/v1');

  const rabbitmqUrl = resolveRabbitMqUrl(configService.get<string>('RABBITMQ_URL'));
  const queue = 'booking_queue';

  // Automatically create queues for this service
  await RmqSetup.setupQueues(configService, 'booking', 10000, 1);

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

  // Swagger Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Booking Service')
    .setDescription('Internal API for Booking Service')
    .setVersion('1.0')
    .addTag('Health')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.startAllMicroservices();
  logger.log(`Booking Service is running and listening to queue: ${queue}`);

  const port = configService.get<number>('PORT') || 3003;
  await app.listen(port);
  logger.log(`Booking Service HTTP server is running on port: ${port}`);
}

void bootstrap();
