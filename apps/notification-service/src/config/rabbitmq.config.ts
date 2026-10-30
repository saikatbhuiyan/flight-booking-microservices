import { MessageHandlerErrorBehavior, RabbitMQConfig, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { EventPatterns, resolveRabbitMqUrl } from '@app/common';

const DEAD_LETTER_EXCHANGE = 'notification.dlq';

/**
 * Event subscriptions. Module config and @RabbitSubscribe must declare each queue with identical arguments
 * (golevelup re-asserts on subscribe; RabbitMQ rejects a mismatch), so both are built from these definitions.
 */
const NOTIFICATION_QUEUES = {
  bookingConfirmed: {
    name: 'notification-service.booking-confirmed',
    exchange: 'booking.events',
    routingKey: EventPatterns.BOOKING_CONFIRMED,
  },
  bookingCancelled: {
    name: 'notification-service.booking-cancelled',
    exchange: 'booking.events',
    routingKey: EventPatterns.BOOKING_CANCELLED,
  },
  paymentFailed: {
    name: 'notification-service.payment-failed',
    exchange: 'payment.events',
    routingKey: EventPatterns.PAYMENT_FAILED,
  },
} as const;

const QUEUE_OPTIONS = { durable: true, arguments: { 'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE } };

/** Failed deliveries are NACKed into notification.dlq (kept in notification-service.dead-letter), never requeued. */
export const SubscribeNotificationEvent = (queue: keyof typeof NOTIFICATION_QUEUES) => {
  const { name, exchange, routingKey } = NOTIFICATION_QUEUES[queue];
  return RabbitSubscribe({
    exchange,
    routingKey,
    queue: name,
    queueOptions: QUEUE_OPTIONS,
    errorBehavior: MessageHandlerErrorBehavior.NACK,
  });
};

export const rabbitmqConfig: RabbitMQConfig = {
  uri: resolveRabbitMqUrl(process.env.RABBITMQ_URL),
  exchanges: [
    { name: 'booking.events', type: 'topic', options: { durable: true } },
    { name: 'payment.events', type: 'topic', options: { durable: true } },
    { name: DEAD_LETTER_EXCHANGE, type: 'topic', options: { durable: true } },
  ],
  channels: {
    'channel-1': {
      prefetchCount: 10,
      default: true,
    },
  },
  queues: [
    ...Object.values(NOTIFICATION_QUEUES).map((queue) => ({ ...queue, options: QUEUE_OPTIONS })),
    {
      name: 'notification-service.dead-letter',
      exchange: DEAD_LETTER_EXCHANGE,
      routingKey: '#',
      options: { durable: true },
    },
  ],
};
