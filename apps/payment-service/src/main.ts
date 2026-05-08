import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PaymentServiceModule } from './payment-service.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import helmet from 'helmet';
import { resolveRabbitMqUrl } from '@app/common';

async function bootstrap() {
  const logger = new Logger('PaymentService');
  const app = await NestFactory.create(PaymentServiceModule, {
    rawBody: true, // Required for webhook signature verification
  });

  // Security
  app.use(helmet());
  app.enableCors();

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Payment Service API')
    .setDescription('Payment processing microservice with Stripe and PayPal support')
    .setVersion('1.0')
    .addTag('Payment Intents')
    .addTag('Refunds')
    .addTag('Webhooks')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Connect to RabbitMQ as microservice
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [resolveRabbitMqUrl(process.env.RABBITMQ_URL)],
      queue: 'payment_queue',
      queueOptions: {
        durable: true,
      },
    },
  });

  await app.startAllMicroservices();
  logger.log('Payment service microservice started');

  const port = process.env.PORT || 3005;
  await app.listen(port);

  logger.log(`Payment service is running on: http://localhost:${port}`);
  logger.log(`Swagger documentation: http://localhost:${port}/api/docs`);
  logger.log(`Payment gateway: ${process.env.PAYMENT_GATEWAY || 'stripe'}`);
}

void bootstrap();
