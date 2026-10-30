# Booking → Payment integration (local-friendly)

## Overview

`booking-service` now creates a **payment intent** by calling `payment-service` over RabbitMQ (RMQ RPC).

For local development, payment can stay disabled so you can still complete the full booking flow end-to-end without starting `payment-service`.

Seats are confirmed with flight-service (synchronous RPC) before any payment is requested, and the booking price
comes from the flight's fare. See [guides/api-migration.md](../guides/api-migration.md) for client-facing changes and
[guides/operations.md](../guides/operations.md) for rollout and dead-letter handling.

## How it works

### Booking creation

When you call `POST /bookings`, `booking-service` runs the booking saga:

1. **Create the booking** (`INITIATED`) and store `booking.created` in the outbox.
2. **Lock the seats in Redis** for the booking window.
3. **Reserve the seats with flight-service** over RMQ RPC (`flight.reserveSeats`, 5s timeout). Flight's reply
   carries the fare for the seat class, which becomes the booking's `totalCost`. Payment is only requested for
   seats that flight has actually reserved.
   - **409 from flight-service** (unknown flight or seat class, not enough seats): the booking is cancelled,
     `booking.cancelled` is published, and `POST /bookings` returns **409**. Nothing is released, because flight took
     nothing.
   - **No answer** (timeout or transport error): the booking is cancelled, a `flight.release-seats` event is queued,
     and `POST /bookings` returns **503**. flight-service only gives back seats this booking actually reserved, so the
     release is safe whether or not the reservation happened.
   - **Retries:** the reservation id is `<sagaId>:reserve-seats`, so a retried call gets the same answer without
     taking seats twice.
4. **Request a payment intent** from `payment-service` over `payment.create_intent`. The payload is always the
   envelope `{ dto, idempotencyKey }`; `dto.amount` is `totalCost` in cents, and `dto.metadata.bookingReference`
   identifies the booking.

The API response includes `paymentRequired`, `autoCompleted`, `totalCost`, `payment.paymentId`,
`payment.clientSecret` (when the gateway returns one) and `payment.provider`.

### Local payment disabled

If `booking-service` resolves to local mock mode:

- It completes the booking straight away with a generated mock transaction id. The response has
  `paymentRequired=false`, `autoCompleted=true`, and the booking is already `BOOKED`.
- `payment.provider` is `local-mock`.

### Payment-service enabled

If `booking-service` resolves to the RMQ payment path:

- The booking stays `PENDING` and the response has `paymentRequired=true` with provider `payment-service`.
- The client reads and confirms the payment through the gateway: `GET /payments/:id` and
  `POST /payments/:id/confirm`. Only the booking owner or an admin can do this.
- When the payment succeeds, payment-service publishes `payment.completed` on `payment.events`. booking-service
  consumes it from `booking-service.payment-completed.v2` and confirms the booking, which publishes
  `booking.confirmed`.
- A failed payment publishes `payment.failed`, which notification-service turns into a message to the user.

### Failure handling

- **Payment-intent creation fails** after the seats are reserved: booking compensates. It releases flight seats and
  Redis locks and marks the booking cancelled.
- **A payment arrives for a cancelled booking:** completion is refused with a conflict. The consumer logs
  `refund required` and acknowledges the message; no refund is issued automatically.
- **Any other error completing a booking from `payment.completed`:** the event is dead-lettered to
  `booking.dead-letter` and can be replayed with `npm run dlq:replay`.
- **Cancellation** (by the user or by compensation) publishes `booking.cancelled` exactly once.

## Configuration

### `booking-service`

- `PAYMENT_REQUIRED`
  - `true`: call `payment-service` over RMQ to create a payment intent.
  - `false`: bypass `payment-service` and auto-complete booking with a local mock.
  - unset:
    - `development` defaults to local mock
    - `production` defaults to real `payment-service`
- `PAYMENT_QUEUE` (default: `payment_queue`)
  - Queue used for RMQ RPC to `payment-service`.
- `RABBITMQ_URL`
  - RMQ broker connection string.

### Local default

To make local mock mode explicit, set this in your local `apps/booking-service/.env`:

```bash
PAYMENT_REQUIRED=false
```

If `PAYMENT_REQUIRED` is omitted entirely, `development` still defaults to local mock mode.

## Notes / constraints

- The payment intent is created for `booking.id` (numeric), with `bookingReference` in metadata; payment events use
  the reference to find the booking.
- Amount is sent in **cents** (smallest currency unit), derived from `booking.totalCost`, which is the flight fare
  multiplied by the seat count.
- Stripe is the supported real gateway path in this repo today. PayPal is registered but intentionally returns `NotImplemented`.
