import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqp-connection-manager';
import { ChannelWrapper } from 'amqp-connection-manager';
import { IMessageBroker, resolveRabbitMqUrl } from '@app/common';

@Injectable()
export class RabbitMQProvider implements IMessageBroker, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQProvider.name);
  private connection: amqp.AmqpConnectionManager;
  private channelWrapper: ChannelWrapper;
  private readonly exchange = 'flight_booking_exchange';
  private readonly dlxExchange = 'flight_booking_dlx';

  constructor(private configService: ConfigService) {}

  async connect(): Promise<void> {
    const url = resolveRabbitMqUrl(this.configService.get<string>('RABBITMQ_URL'));

    this.connection = amqp.connect([url], {
      heartbeatIntervalInSeconds: 30,
      reconnectTimeInSeconds: 5,
    });

    this.connection.on('connect', () => {
      this.logger.log('Connected to RabbitMQ');
    });

    this.connection.on('disconnect', (err) => {
      this.logger.error('Disconnected from RabbitMQ', err);
    });

    this.channelWrapper = this.connection.createChannel({
      json: true,
      setup: async (channel: any) => {
        // Create main exchange
        await channel.assertExchange(this.exchange, 'topic', {
          durable: true,
        });

        // Create dead letter exchange
        await channel.assertExchange(this.dlxExchange, 'topic', {
          durable: true,
        });

        // Create DLQ
        await channel.assertQueue('dead_letter_queue', {
          durable: true,
        });

        await channel.bindQueue('dead_letter_queue', this.dlxExchange, '#');

        this.logger.log('RabbitMQ channel setup completed');
      },
    });

    await this.channelWrapper.waitForConnect();
  }

  async disconnect(): Promise<void> {
    await this.channelWrapper.close();
    await this.connection.close();
    this.logger.log('Disconnected from RabbitMQ');
  }

  async publish<TInput>(pattern: string, data: TInput): Promise<void> {
    try {
      await this.channelWrapper.publish(this.exchange, pattern, data, {
        deliveryMode: 2,
        timestamp: Date.now(),
      });
      this.logger.debug(`Published message to ${pattern}`);
    } catch (error) {
      this.logger.error(`Failed to publish message to ${pattern}`, error);
      throw error;
    }
  }

  async subscribe<TInput>(pattern: string, handler: (data: TInput) => Promise<void>): Promise<void> {
    const queueName = `queue_${pattern.replace(/\./g, '_')}`;

    await this.channelWrapper.addSetup(async (channel: any) => {
      await channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': this.dlxExchange,
          'x-message-ttl': 86400000, // 24 hours
        },
      });

      await channel.bindQueue(queueName, this.exchange, pattern);

      await channel.consume(
        queueName,
        async (msg: any) => {
          if (msg) {
            try {
              const content = JSON.parse(msg.content.toString());
              await handler(content);
              channel.ack(msg);
              this.logger.debug(`Processed message from ${pattern}`);
            } catch (error) {
              this.logger.error(`Error processing message from ${pattern}`, error);
              // Reject and don't requeue - send to DLQ
              channel.nack(msg, false, false);
            }
          }
        },
        {
          noAck: false,
        },
      );
    });

    this.logger.log(`Subscribed to pattern: ${pattern}`);
  }

  emit<TInput>(pattern: string, data: TInput): void {
    this.publish(pattern, data).catch((error) => {
      this.logger.error(`Failed to emit message to ${pattern}`, error);
    });
  }

  async onModuleDestroy() {
    await this.disconnect();
  }
}
