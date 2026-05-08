import { RabbitMQConfig } from '@golevelup/nestjs-rabbitmq';
import { resolveRabbitMqUrl } from '@app/common';

// RABBITMQ CONFIGURATION WITH DLQ
export const rabbitmqConfig: RabbitMQConfig = {
  uri: resolveRabbitMqUrl(process.env.RABBITMQ_URL),
  exchanges: [
    {
      name: 'booking.events',
      type: 'topic',
      options: { durable: true },
    },
    {
      name: 'booking.dlq',
      type: 'topic',
      options: { durable: true },
    },
  ],
  channels: {
    'channel-1': {
      prefetchCount: 10,
      default: true,
    },
  },
  queues: [
    {
      name: 'flight-service.reserve-seats',
      exchange: 'booking.events',
      routingKey: 'flight.reserve-seats',
      options: {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'booking.dlq',
          'x-dead-letter-routing-key': 'flight.reserve-seats.failed',
          'x-message-ttl': 300000, // 5 minutes
          'x-max-retries': 3,
        },
      },
    },
    {
      name: 'flight-service.confirm-seats',
      exchange: 'booking.events',
      routingKey: 'flight.confirm-seats',
      options: {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'booking.dlq',
        },
      },
    },
    {
      name: 'flight-service.release-seats',
      exchange: 'booking.events',
      routingKey: 'flight.release-seats',
      options: {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'booking.dlq',
        },
      },
    },
  ],
};
