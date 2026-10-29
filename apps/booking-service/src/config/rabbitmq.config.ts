import { MessageHandlerErrorBehavior, RabbitMQConfig, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { EventPatterns, resolveRabbitMqUrl } from '@app/common';

/**
 * Module config and @RabbitSubscribe must declare a queue with identical arguments (golevelup re-asserts it on
 * subscribe and RabbitMQ rejects a mismatch), so both come from this definition.
 */
const SEAT_RESERVATION_FAILED_QUEUE = {
  name: 'booking-service.seat-reservation-failed',
  exchange: 'flight.events',
  routingKey: EventPatterns.FLIGHT_SEATS_RESERVATION_FAILED,
  options: { durable: true, arguments: { 'x-dead-letter-exchange': 'booking.dlq' } },
};

/** Failures are NACKed into booking.dlq (kept in booking.dead-letter) rather than requeued in a hot loop. */
export const SubscribeSeatReservationFailed = () =>
  RabbitSubscribe({
    exchange: SEAT_RESERVATION_FAILED_QUEUE.exchange,
    routingKey: SEAT_RESERVATION_FAILED_QUEUE.routingKey,
    queue: SEAT_RESERVATION_FAILED_QUEUE.name,
    queueOptions: SEAT_RESERVATION_FAILED_QUEUE.options,
    errorBehavior: MessageHandlerErrorBehavior.NACK,
  });

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
    {
      // Same definition as flight-service's, so booking's dead letters are kept even if flight never started.
      name: 'booking.dead-letter',
      exchange: 'booking.dlq',
      routingKey: '#',
      options: { durable: true },
    },
  ],
};
