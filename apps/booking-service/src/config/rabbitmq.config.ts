import { MessageHandlerErrorBehavior, RabbitMQConfig, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { EventPatterns, resolveRabbitMqUrl } from '@app/common';

interface EventQueue {
  name: string;
  exchange: string;
  routingKey: string;
  options: { durable: boolean; arguments: Record<string, unknown> };
}

const DEAD_LETTER = { 'x-dead-letter-exchange': 'booking.dlq' };

/**
 * Module config and @RabbitSubscribe must declare a queue with identical arguments (golevelup re-asserts it on
 * subscribe and RabbitMQ rejects a mismatch), so both come from these definitions.
 */
const SEAT_RESERVATION_FAILED_QUEUE: EventQueue = {
  name: 'booking-service.seat-reservation-failed',
  exchange: 'flight.events',
  routingKey: EventPatterns.FLIGHT_SEATS_RESERVATION_FAILED,
  options: { durable: true, arguments: DEAD_LETTER },
};

/**
 * `.v2`: the original booking-service.payment-completed had no dead-letter exchange, and changing a queue's arguments
 * means deleting it (losing confirmations published meanwhile). A new queue lets both run until the old one is deleted.
 */
const PAYMENT_COMPLETED_QUEUE: EventQueue = {
  name: 'booking-service.payment-completed.v2',
  exchange: 'payment.events',
  routingKey: EventPatterns.PAYMENT_COMPLETED,
  options: { durable: true, arguments: DEAD_LETTER },
};

/** Failures are NACKed into booking.dlq (kept in booking.dead-letter) rather than requeued in a hot loop. */
const subscribeTo = (queue: EventQueue) =>
  RabbitSubscribe({
    exchange: queue.exchange,
    routingKey: queue.routingKey,
    queue: queue.name,
    queueOptions: queue.options,
    errorBehavior: MessageHandlerErrorBehavior.NACK,
  });

export const SubscribeSeatReservationFailed = () => subscribeTo(SEAT_RESERVATION_FAILED_QUEUE);
export const SubscribePaymentCompleted = () => subscribeTo(PAYMENT_COMPLETED_QUEUE);

export const rabbitmqConfig: RabbitMQConfig = {
  uri: resolveRabbitMqUrl(process.env.RABBITMQ_URL),
  exchanges: [
    {
      name: 'booking.events',
      type: 'topic',
      options: { durable: true },
    },
    {
      name: 'payment.events',
      type: 'topic',
      options: { durable: true },
    },
    {
      name: 'booking.dlq',
      type: 'topic',
      options: { durable: true },
    },
    {
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
    SEAT_RESERVATION_FAILED_QUEUE,
    PAYMENT_COMPLETED_QUEUE,
    {
      // Same definition as flight-service's, so booking's dead letters are kept even if flight never started.
      name: 'booking.dead-letter',
      exchange: 'booking.dlq',
      routingKey: '#',
      options: { durable: true },
    },
  ],
};
