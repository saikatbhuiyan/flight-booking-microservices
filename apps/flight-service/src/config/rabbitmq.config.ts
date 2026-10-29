import { MessageHandlerErrorBehavior, RabbitMQConfig, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { EventPatterns, resolveRabbitMqUrl } from '@app/common';

/**
 * Seat event subscriptions. The module config and each @RabbitSubscribe must declare a queue with identical
 * arguments (golevelup re-asserts the queue on subscribe, and RabbitMQ rejects a mismatch with PRECONDITION_FAILED),
 * so both are built from these definitions.
 *
 * Arguments are kept exactly as first deployed so existing brokers need no migration. `x-max-retries` is not a
 * RabbitMQ feature and has no effect.
 */
const SEAT_EVENT_QUEUES = {
  reserve: {
    name: 'flight-service.reserve-seats',
    routingKey: EventPatterns.FLIGHT_RESERVE_SEATS,
    options: {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'booking.dlq',
        'x-dead-letter-routing-key': `${EventPatterns.FLIGHT_RESERVE_SEATS}.failed`,
        'x-message-ttl': 300000, // 5 minutes
        'x-max-retries': 3,
      },
    },
  },
  confirm: {
    name: 'flight-service.confirm-seats',
    routingKey: EventPatterns.FLIGHT_CONFIRM_SEATS,
    options: { durable: true, arguments: { 'x-dead-letter-exchange': 'booking.dlq' } },
  },
  release: {
    name: 'flight-service.release-seats',
    routingKey: EventPatterns.FLIGHT_RELEASE_SEATS,
    options: { durable: true, arguments: { 'x-dead-letter-exchange': 'booking.dlq' } },
  },
} as const;

/**
 * Subscribes to a seat event queue. Failed messages are NACKed into booking.dlq (kept in booking.dead-letter for
 * inspection/replay) instead of golevelup's default REQUEUE, which redelivers a failing message in a hot loop.
 */
export const SubscribeSeatEvent = (queue: keyof typeof SEAT_EVENT_QUEUES) => {
  const { name, routingKey, options } = SEAT_EVENT_QUEUES[queue];
  return RabbitSubscribe({
    exchange: 'booking.events',
    routingKey,
    queue: name,
    queueOptions: options,
    errorBehavior: MessageHandlerErrorBehavior.NACK,
  });
};

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
    {
      // Events flight-service publishes back to the booking saga.
      name: 'flight.events',
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
    ...Object.values(SEAT_EVENT_QUEUES).map(({ name, routingKey, options }) => ({
      name,
      exchange: 'booking.events',
      routingKey,
      options,
    })),
    {
      // Without a bound queue, everything dead-lettered to booking.dlq was silently dropped.
      name: 'booking.dead-letter',
      exchange: 'booking.dlq',
      routingKey: '#',
      options: { durable: true },
    },
  ],
};
