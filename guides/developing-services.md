# Developing services

How to add features to the flight-booking services without breaking the messaging rules. Each section is a
step-by-step tutorial built on code that already exists in the repo, so you can open the files and follow along.

- [How requests flow](#how-requests-flow)
- [Tutorial 1: add an operation behind the gateway](#tutorial-1-add-an-operation-behind-the-gateway)
- [Tutorial 2: consume a domain event](#tutorial-2-consume-a-domain-event)
- [Tutorial 3: publish a domain event](#tutorial-3-publish-a-domain-event)
- [Rules the tests enforce](#rules-the-tests-enforce)
- [Verifying against real RabbitMQ](#verifying-against-real-rabbitmq)

## How requests flow

```text
client ──HTTP──▶ api-gateway ──RMQ request/response──▶ service ──▶ Postgres / Redis
                 (JWT, roles,                            │
                  ownership,                             └──RMQ events (golevelup)──▶ other services
                  rate limits)
```

- **The gateway is the only public API.** Services serve RabbitMQ handlers plus `/api/v1/health`; payment-service
  also serves provider webhooks. Never add a business HTTP route to a service.
- **Authorization happens at the gateway.** Services trust their payloads, so identity fields such as `userId` must
  come from `@CurrentUser()` at the gateway, never from the request body.
- **Request/response is at-most-once.** A handler error is replied to the caller and the message is never
  redelivered. Don't add server-side retries or manual ack/nack.
- **Events are at-least-once.** Consumers must be idempotent. Failures go to a dead-letter queue, not back to the
  queue.

## Tutorial 1: add an operation behind the gateway

Worked example: **restore a soft-deleted city** (`PATCH /api/v1/cities/:id/restore`, admin only). Every step below is
already in the code.

### Step 1: name the message pattern

All RPC patterns live in one enum, `libs/common/src/interfaces/index.ts`. Never use raw strings.

```ts
export enum MessagePatterns {
  // ...
  CITY_RESTORE = 'city.restore',
}
```

### Step 2: define the payload as a DTO class

`RpcValidationPipe` only validates payloads typed with a class. Inline types like `{ id: number }`, intersections,
unions and `any` are skipped, and a test fails the build if you use one. Reuse an existing message DTO from
`libs/common/src/dto/*/*-messages.dto.ts`, or add one there:

```ts
// libs/common/src/dto/flight/catalog-messages.dto.ts
export class IdMessageDto {
  @IsInt()
  @IsPositive()
  id: number;
}
```

For a nested payload, use `@ValidateNested()` with `@Type(() => Inner)`; see `UpdateCityMessageDto` in the same file.
The pipe strips unknown fields and converts types implicitly, so `"42"` becomes `42` for a number field.

### Step 3: handle it in the service

The handler goes on a controller with **all three** class decorators. App-level filters and pipes never reach
RabbitMQ handlers, so leaving one off silently turns every 4xx into a 500 or skips validation.

```ts
// apps/flight-service/src/modules/city/controllers/city.controller.ts
@Controller()
@UseFilters(CommonRpcExceptionFilter)
@UsePipes(RpcValidationPipe)
export class CityController {
  @MessagePattern(MP.CITY_RESTORE)
  async handleRestore(@Payload() data: IdMessageDto) {
    return this.cityService.restore(data.id);
  }
}
```

Throw Nest HTTP exceptions (`NotFoundException`, `ConflictException`, …) from the service. `CommonRpcExceptionFilter`
sends `{ status, message, code }` back, and the gateway turns it into the same HTTP status.

### Step 4: expose it at the gateway

```ts
// apps/api-gateway/src/controllers/city.controller.ts
@Patch(':id/restore')
@Roles(Role.ADMIN)
@ApiBearerAuth()
@ApiOperation({ summary: 'Restore a soft-deleted city' })
async restore(@Param('id', ParseIntPipe) id: number) {
  const result = await this.callService(MP.CITY_RESTORE, { id });
  return ApiResponseDto.success(result, 'city.restore.success');
}
```

- **Authentication:** every route requires a JWT unless it has `@Public()`.
- **Roles:** use `@Roles(Role.ADMIN)` for admin-only routes. Roles come from `users.role` in the database, not from
  the token.
- **Ownership:** for user-owned data, check it at the gateway and return **404** to non-owners so IDs can't be
  probed. The model is `assertCanAccess` in `apps/api-gateway/src/controllers/payment.controller.ts`:

  ```ts
  if (user.role === Role.ADMIN || Number(payment?.userId) === Number(user.id)) return;
  throw new NotFoundException({ code: 'resource.not_found', message: 'Payment not found' });
  ```

- **Mutations clients could abuse:** add `@RateLimit({ points, duration })`.
- **Response codes:** add the code (`city.restore.success`) to `libs/common/src/messages/success.ts`.

### Step 5: if the gateway talks to a new service

Register a client using the shared queue definition, so the client and server declare the queue identically. A
mismatch makes RabbitMQ reject the declaration with `PRECONDITION_FAILED`.

```ts
ClientsModule.registerAsync([{
  name: 'PAYMENT_SERVICE',
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    transport: Transport.RMQ,
    options: {
      urls: [resolveRabbitMqUrl(config.get<string>('RABBITMQ_URL'))],
      queue: RpcQueue.PAYMENT,
      queueOptions: RPC_QUEUE_OPTIONS,
    },
  }),
}]);
```

### Step 6: test

- **Unit test** the gateway controller with a mocked `ClientProxy`, especially the role and ownership branches. See
  `apps/api-gateway/src/controllers/payment.controller.spec.ts`.
- **Run the checks:** `npx tsc --noEmit -p tsconfig.json && npx jest && npm run lint:check`. Never use
  `npm run lint` to verify; it rewrites files.

## Tutorial 2: consume a domain event

Worked example: notification-service sending a message when a booking is confirmed.

### Step 1: declare the queue once and subscribe from that declaration

golevelup re-declares a queue when a `@RabbitSubscribe` starts. If the module config and the decorator disagree on
the queue's options, RabbitMQ rejects it and **the consumer never starts**. That is how flight-service's seat
consumers ended up never consuming. So build both from one definition:

```ts
// apps/notification-service/src/config/rabbitmq.config.ts
const NOTIFICATION_QUEUES = {
  bookingConfirmed: {
    name: 'notification-service.booking-confirmed',
    exchange: 'booking.events',
    routingKey: EventPatterns.BOOKING_CONFIRMED,
  },
} as const;

const QUEUE_OPTIONS = { durable: true, arguments: { 'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE } };

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
```

The module config's `queues` are built from the same `NOTIFICATION_QUEUES`, plus a dead-letter queue bound with
`'#'` to the dead-letter exchange.

- **Always use `errorBehavior: NACK`.** golevelup's default, REQUEUE, redelivers a failing message immediately and
  forever.
- **Always add a dead-letter exchange and bind a queue to it.** Otherwise dead-lettered messages are dropped.

### Step 2: write an idempotent handler

```ts
@SubscribeNotificationEvent('bookingConfirmed')
handleBookingConfirmed(event: BookingConfirmedEvent): Promise<void> {
  return this.notificationService.bookingConfirmed(event);
}
```

Events can arrive more than once, so deduplicate on a stable key:

- **Outbox events** carry `event._metadata.eventId`.
- **flight-service** records processed events in `processed_events`.
- **notification-service** claims a Redis key with `SET NX`, and deletes it again if the send fails so a replay can
  retry.

Decide what a failure means:

- **Transient** (database or provider down): throw. The message is dead-lettered and can be replayed later.
- **Business outcome** (for example, a payment for a cancelled booking): log it and return. Rethrowing would only
  dead-letter something that will never succeed.

### Step 3: changing an existing queue's arguments

You can't change a declared queue's arguments in place. Either delete and recreate it during a coordinated restart,
or, for queues that must not lose messages, add a new versioned queue (`booking-service.payment-completed.v2`),
deploy, and then delete the old one.

## Tutorial 3: publish a domain event

- **booking-service publishes through the outbox.** Call `outboxService.storeEvent(aggregate, id, EventPatterns.X,
  payload, manager)` inside the same transaction as the state change. The outbox worker publishes it to
  `booking.events` with `_metadata.eventId`.
- **Other services publish directly:** `amqpConnection.publish('payment.events', EventPatterns.X, payload)`. Do it
  after the database transaction commits, and include the owner (`userId`) so consumers such as notifications don't
  need another lookup.
- **Add every routing key to `EventPatterns`.**

## Rules the tests enforce

`libs/common/src/rmq/rpc-controller-wiring.spec.ts` fails if any `*.controller.ts` with a `@MessagePattern`:

- is missing `@UseFilters(CommonRpcExceptionFilter)`,
- is missing `@UsePipes(RpcValidationPipe)`, or
- has a `@Payload()` typed as an inline object, intersection, union or `any`.

## Verifying against real RabbitMQ

Unit tests can't see transport wiring: filters, pipes, queue declarations or consumers. Before you call messaging
work done, boot the real controller or handler, with its services mocked, against a throwaway broker on a
non-default port:

```bash
docker run -d --name fb-verify-rmq -e RABBITMQ_DEFAULT_USER=admin -e RABBITMQ_DEFAULT_PASS=admin \
  -p 56729:5672 rabbitmq:3.12-alpine
# wait for "Server startup complete" in `docker logs fb-verify-rmq`

NODE_PATH=$PWD/node_modules TS_NODE_TRANSPILE_ONLY=true TS_NODE_PROJECT=$PWD/tsconfig.json \
  node -r ts-node/register -r tsconfig-paths/register path/to/check.ts

docker rm -f fb-verify-rmq
```

Two gotchas:

- **Two golevelup apps in one Node process don't both attach consumers.** Test each service's consumers in its own
  process.
- **`{ logger: false }` hides Nest's warnings.** For example, "Cannot apply global exception filters" is how
  filter-ordering bugs show up.
