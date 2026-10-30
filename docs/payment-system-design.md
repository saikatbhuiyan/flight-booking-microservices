# Payment System Design For Flight Bookings

## Goals

- Support payment intent creation, confirmation, webhook processing, refunds, and ledgering.
- Remain safe under client retries, webhook replay, and partial failure scenarios.
- Provide a clean base for multi-gateway expansion and financial reconciliation.

## Core Tables

### `payments`

- One row per customer payment intent / payment lifecycle.
- Stores booking reference, customer, gateway, client secret, state transitions, and failure context.
- Main statuses:
  - `pending`
  - `requires_action`
  - `processing`
  - `confirmed`
  - `failed`
  - `partially_refunded`
  - `refunded`
  - `canceled`

### `idempotency_keys`

- One row per replay-safe API operation.
- Scoped by operation, for example:
  - `create_payment_intent`
  - `confirm_payment:{paymentId}`
  - `refund:{paymentId}`
- Stores request hash, response body, resource linkage, expiry, and failure details.

### `refunds`

- One row per refund attempt.
- Linked back to the original `payments` row.
- Supports partial refunds, failure reasons, refund idempotency, and gateway refund references.

### `ledger_entries`

- Financial journal rows for every successful payment and refund.
- Current implementation writes paired debit/credit entries per business event.
- Supports reporting, settlement review, and reconciliation exports.

## Additional Production Tables Recommended

### `webhook_events`

- Deduplicates third-party webhook deliveries.
- Tracks raw payload hash, processing status, and processing errors.

### `payment_audit_log`

- Immutable operational audit trail.
- Useful for support tooling, incident review, and compliance evidence.

## Implemented Flows

### 1. Create Payment Intent

1. Accept booking, user, amount, currency, and payment method.
2. Claim an idempotency key.
3. Route to the selected gateway provider.
4. Persist a `payments` row.
5. Cache the response in `idempotency_keys`.
6. Emit internal event `payment.intent.created`.

### 2. Confirm Payment Intent

1. Claim scoped idempotency key for the payment.
2. Load payment and short-circuit if already terminal.
3. Confirm or capture through the gateway.
4. Update payment state to `confirmed` or `failed`.
5. Write paired ledger entries on success.
6. Emit `payment.succeeded` or `payment.failed`.

### 3. Handle Webhooks

1. Verify gateway signature.
2. Store deduplicated `webhook_events` row.
3. Apply payment transition based on event type.
4. Mark webhook as processed.
5. Preserve audit logs for replay visibility.

### 4. Process Refunds

1. Claim scoped refund idempotency key.
2. Validate the original payment is refundable.
3. Prevent over-refunds by summing prior successful refunds.
4. Call the gateway refund API.
5. Persist refund result and update payment state.
6. Write paired refund ledger entries on success.

### 5. Maintain Ledger Entries

- Payment success:
  - debit `asset:gateway_clearing`
  - credit `liability:customer_funds`
- Refund success:
  - debit `liability:customer_funds`
  - credit `asset:gateway_clearing`

This keeps the service ready for downstream settlement, revenue recognition, and payout reporting.

## What Makes It Production Grade

### Reliability

- Idempotent create, confirm, and refund endpoints.
- Webhook deduplication.
- Explicit terminal and transitional states.
- Transactional DB writes around critical state changes.

### Financial Safety

- Refund ceiling enforcement.
- Ledger rows for all successful money movement.
- Audit trail for support and investigations.

### Scale

- Stateless service nodes.
- Database-backed idempotency coordination.
- Gateway abstraction for processor expansion.
- Read-friendly ledger indexes for reconciliation queries.

## What To Add Next For Large Scale

### High Priority

- Outbox table plus async publisher for exactly-once event dispatch to RabbitMQ.
- Reconciliation cron jobs against Stripe / PayPal balance transactions.
- Dead-letter queue handling for failed payment and webhook jobs.
- Admin endpoints for replaying failed webhooks and reconciliation mismatches.
- Background timeout sweeper for stale `pending` and `processing` payments.

### Resilience

- Redis distributed lock for high-contention payment or refund operations.
- Circuit breaker and retry policy around gateway API calls.
- Gateway health scoring and controlled failover.
- Backpressure and queue-based async confirmation when gateway latency spikes.

### Risk And Fraud

- Fraud screening hooks before confirmation.
- Velocity limits per user, card fingerprint, IP, and booking.
- Manual review queue for suspicious bookings.
- Device fingerprint and 3DS challenge result storage.

### Finance And Reporting

- Settlement table separate from operational ledger.
- Fee ledger entries for gateway fees and chargebacks.
- Multi-currency FX rate snapshots.
- Revenue recognition split between booking creation and ticket issuance if required.

### Compliance And Security

- Secrets in a managed vault.
- Webhook secret rotation support.
- PCI scope minimization: never store PAN/CVV, store only gateway tokens.
- PII minimization and audit log redaction policy.

### Observability

- Metrics:
  - payment create success rate
  - confirmation latency
  - refund failure rate
  - webhook replay count
  - reconciliation mismatch count
- Distributed tracing with booking ID and payment ID correlation.
- Alerting on stuck payments, webhook failures, and refund spikes.

## API Surface

Public routes are served by the API gateway (`/api/v1`, JWT required). Non-owners get `404`.

- `GET /payments/:id` — owner or admin
- `POST /payments/:id/confirm` — owner or admin, optional `idempotency-key` header
- `GET /payments/booking/:bookingId` — owner or admin
- `GET /payments/booking/:bookingId/refunds` — owner or admin
- `POST /payments/refunds` — admin, optional `idempotency-key` header
- `GET /payments/ledger/entries` — admin

Payment intents are created only by `booking-service` (RPC `payment.create_intent`); there is no public create route.

payment-service itself serves only the provider webhooks over HTTP:

- `POST /webhooks/stripe`
- `POST /webhooks/paypal`

## Recommended Next Implementation Milestones

1. Add outbox publishing and payment-domain events consumed by booking-service.
2. Add reconciliation worker and failed-webhook replay worker.
3. Add Redis lock and rate limiting for refund and confirmation hotspots.
4. Add finance-facing exports and dashboard queries.
5. Add chargeback lifecycle support.

## Booking integration (current state)

- `booking-service` creates payment intents via RabbitMQ RPC (`payment.create_intent`).
- For local development, `booking-service` can bypass payment by setting `PAYMENT_REQUIRED=false`.
