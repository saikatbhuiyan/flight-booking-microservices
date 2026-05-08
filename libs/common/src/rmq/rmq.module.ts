import { Module, Global, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import { resolveRabbitMqUrl } from '../utils';

@Global()
@Module({})
export class RmqSetup {
  private static readonly logger = new Logger('RmqSetup');

  static async setupQueues(configService: ConfigService, serviceName: string, retryDelayMs = 10000, maxRetries = 3) {
    const rabbitmqUrl = resolveRabbitMqUrl(configService.get<string>('RABBITMQ_URL'));

    let connection;
    let retries = 0;
    while (retries < maxRetries) {
      try {
        connection = await connect(rabbitmqUrl);
        break;
      } catch (err) {
        retries++;
        this.logger.warn(
          `Failed to connect to RabbitMQ (${retries}/${maxRetries}). Retrying in ${retryDelayMs / 1000}s...`,
        );
        if (retries >= maxRetries) throw err;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    const channel = await connection.createChannel();

    const mainQueue = `${serviceName}_queue`;
    const retryQueue = `${serviceName}_queue_retry`;
    const deadQueue = `${serviceName}_queue_dead`;

    // 1️⃣ Create Dead Letter Queue (final destination)
    await channel.assertQueue(deadQueue, { durable: true });

    // 2️⃣ Create Retry Queue (delayed retries)
    await channel.assertQueue(retryQueue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '', // send back to main queue
        'x-dead-letter-routing-key': mainQueue,
        'x-message-ttl': retryDelayMs, // retry delay in ms
      },
    });

    // 3️⃣ Create Main Queue
    await channel.assertQueue(mainQueue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': retryQueue, // on failure -> go to retry
        'x-max-length': 10000, // optional, limit queue size
      },
    });

    this.logger.log(`✅ RabbitMQ queues ready: ${mainQueue}, ${retryQueue}, ${deadQueue}`);

    await channel.close();
    await connection.close();
  }
}
