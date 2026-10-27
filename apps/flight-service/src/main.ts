import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FlightServiceModule } from './flight-service.module';
import { CommonRpcExceptionFilter, RPC_QUEUE_OPTIONS, RpcQueue, resolveRabbitMqUrl } from '@app/common';
import { initializeTracing } from '@app/telemetry';

async function bootstrap() {
  const logger = new Logger('FlightService');
  const app = await NestFactory.create(FlightServiceModule);
  const configService = app.get(ConfigService);
  app.enableShutdownHooks();
  const rabbitmqUrl = resolveRabbitMqUrl(configService.get<string>('RABBITMQ_URL'));
  const queue = RpcQueue.FLIGHT;

  initializeTracing('flight-service');

  // Global prefix for HTTP routes
  app.setGlobalPrefix('api/v1');

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.RMQ,
      options: {
        urls: [rabbitmqUrl],
        queue,
        queueOptions: RPC_QUEUE_OPTIONS,
        prefetchCount: 1,
        noAck: true,
      },
    },
    { inheritAppConfig: true },
  );

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
    .setTitle('Flight Service')
    .setDescription('Internal API for Flight Service')
    .setVersion('1.0')
    .addTag('Health')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.startAllMicroservices();
  logger.log(`Flight Service is running and listening to queue: ${queue}`);

  const port = configService.get<number>('PORT') || 3002;
  await app.listen(port);
  logger.log(`Flight Service HTTP server is running on port: ${port}`);
}

void bootstrap();
