import { RabbitMQConfig } from '@golevelup/nestjs-rabbitmq';
import { resolveRabbitMqUrl } from '@app/common';

export const rabbitmqConfig: RabbitMQConfig = {
  uri: resolveRabbitMqUrl(process.env.RABBITMQ_URL),
  exchanges: [
    {
      name: 'payment.events',
      type: 'topic',
      options: { durable: true },
    },
    {
      name: 'booking.events',
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
  enableControllerDiscovery: true,
};
