/**
 * Request/response (ClientProxy.send ↔ @MessagePattern) queues.
 *
 * Servers and every client of a queue must declare it with identical arguments, otherwise RabbitMQ rejects the
 * second declaration with PRECONDITION_FAILED — so both sides take their options from here.
 *
 * RPC is at-most-once: servers run with noAck, handler errors are replied to the caller, and nothing is
 * redelivered, so these queues deliberately have no dead-letter/retry topology. Retries belong to the caller.
 */
export const RpcQueue = {
  AUTH: 'auth_queue',
  FLIGHT: 'flight_queue',
  BOOKING: 'booking_queue',
  NOTIFICATION: 'notification_queue',
  PAYMENT: 'payment_queue',
} as const;

export const RPC_QUEUE_OPTIONS = {
  durable: true,
  arguments: {
    // Bounds broker memory if a service is down; the oldest requests are dropped and their callers time out.
    'x-max-length': 10000,
  },
};
