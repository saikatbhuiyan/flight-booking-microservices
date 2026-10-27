import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthServiceModule } from './auth-service.module';
import { RPC_QUEUE_OPTIONS, RpcQueue, resolveRabbitMqUrl } from '@app/common';

async function bootstrap() {
  const logger = new Logger('AuthService');
  const app = await NestFactory.create(AuthServiceModule);
  const configService = app.get(ConfigService);
  app.enableShutdownHooks();
  const rabbitmqUrl = resolveRabbitMqUrl(configService.get<string>('RABBITMQ_URL'));
  const queue = RpcQueue.AUTH;

  // Global prefix for HTTP routes
  app.setGlobalPrefix('api/v1');

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [rabbitmqUrl],
      queue: queue,
      queueOptions: RPC_QUEUE_OPTIONS,
      prefetchCount: 1,
      // Request/response is at-most-once: handler errors are replied to the caller, never redelivered.
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
