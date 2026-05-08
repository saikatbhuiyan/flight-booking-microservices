import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthServiceModule } from './auth-service.module';
import { RmqSetup, resolveRabbitMqUrl } from '@app/common';

async function bootstrap() {
  const logger = new Logger('AuthService');
  const app = await NestFactory.create(AuthServiceModule);
  const configService = app.get(ConfigService);
  const rabbitmqUrl = resolveRabbitMqUrl(configService.get<string>('RABBITMQ_URL'));
  const queue = 'auth_queue';

  // Automatically create queues for this service
  await RmqSetup.setupQueues(configService, 'auth', 10000, 1);

  // Global prefix for HTTP routes
  app.setGlobalPrefix('api/v1');

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [rabbitmqUrl],
      queue: queue,
      queueOptions: {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': `${queue}_retry`,
          'x-max-length': 10000,
        },
      },
      prefetchCount: 1,
      noAck: false, // manual ack pattern
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Auth Service')
    .setDescription('Internal API for Auth Service')
    .setVersion('1.0')
    .addTag('Health')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.startAllMicroservices();
  logger.log(`Auth Service is running and listening to queue: ${queue}`);

  const port = configService.get<number>('PORT') || 3001;
  await app.listen(port);
  logger.log(`Auth Service HTTP server is running on port: ${port}`);
}

void bootstrap();
