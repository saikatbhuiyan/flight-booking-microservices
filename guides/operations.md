# Operations runbook

For whoever deploys and runs the stack. It covers the one-time rollout of this release, routine tasks, and how to
diagnose the failures you're most likely to see. Commands assume the docker-compose container names; change them
for other environments.

- [Rolling out this release](#rolling-out-this-release)
- [Granting admin access](#granting-admin-access)
- [Enabling email notifications](#enabling-email-notifications)
- [Dead-lettered events](#dead-lettered-events)
- [Troubleshooting](#troubleshooting)

## Rolling out this release

This release changes RabbitMQ queue arguments, so **it can't be rolled out service by service**. Old and new
services would declare the same queues with different arguments and reject each other. Plan a short, coordinated
restart.

1. **Stop all application services.** Leave Postgres, Redis, RabbitMQ and LocalStack running.

   ```bash
   docker compose stop api-gateway auth-service flight-service booking-service notification-service payment-service
   ```

2. **Delete the old RPC queues.** Requests waiting in them are lost, but their callers have already timed out.

   ```bash
   docker exec flight-booking-rabbitmq sh -c 'for s in auth flight booking notification payment; do
     for q in ${s}_queue ${s}_queue_retry ${s}_queue_dead; do rabbitmqctl -q delete_queue "$q" || true; done
   done'
   ```

3. **Apply the auth database baseline.** On a database that `synchronize` already created, this only adds the
   `users.role` column.

   ```bash
   npm run migration:run:auth
   ```

4. **Start the services that others depend on first,** then booking, then the gateway:

   ```bash
   docker compose up -d auth-service flight-service payment-service notification-service
   docker compose up -d booking-service
   docker compose up -d api-gateway
   ```

5. **Once booking-service is running, delete the two retired queues.**
   - `booking-service.events` was never consumed and holds stale events.
   - `booking-service.payment-completed` has been replaced by `booking-service.payment-completed.v2`, which has
     received every event since booking-service started. Anything left in the old queue is a duplicate.

   ```bash
   docker exec flight-booking-rabbitmq rabbitmqctl delete_queue booking-service.events
   docker exec flight-booking-rabbitmq rabbitmqctl delete_queue booking-service.payment-completed
   ```

6. **Grant admin access** to at least one account ([below](#granting-admin-access)). Until you do, nobody can manage
   flights, cities, airports, airplanes or seats.

7. **Smoke test:**
   - Each service's `/api/v1/health` responds.
   - As an admin, `GET /api/v1/cities/statistics` returns 200.
   - A booking for an available flight returns 201 with a non-zero `totalCost`.

### Verify the release is healthy

- **Every service starts without `PRECONDITION_FAILED` in its logs.**
- **RabbitMQ shows consumers on the new queues:**

  ```bash
  docker exec flight-booking-rabbitmq rabbitmqctl list_queues name consumers messages | grep -E 'flight-service|booking-service|notification-service'
  ```

  `flight-service.reserve-seats`, `-confirm-seats`, `-release-seats`, `booking-service.payment-completed.v2`,
  `booking-service.seat-reservation-failed` and the three `notification-service.*` queues should each have at least
  one consumer.

## Granting admin access

Roles are stored in `users.role` in `auth_db` (`admin`, `user` or `agent`; default `user`) and read on every request,
so a change takes effect on the user's next request. No new token is needed.

```bash
docker exec flight-booking-postgres psql -U postgres -d auth_db \
  -c "UPDATE users SET role = 'admin' WHERE email = 'ops@example.com';"
```

There is deliberately no API for changing roles.

## Enabling email notifications

notification-service logs notifications by default. To send email through Amazon SES:

1. **In `apps/notification-service/.env`, set:**

   ```bash
   NOTIFICATION_PROVIDER=ses
   NOTIFICATION_FROM_EMAIL=no-reply@flight-booking.local   # must be a verified SES identity
   AWS_REGION=us-east-1
   AWS_ENDPOINT=http://localstack:4566                     # LocalStack; omit for real AWS
   ```

2. **Verify the sender identity.** With LocalStack, `npm run setup:localstack` does this. With real AWS, verify the
   address or domain in SES and request production access.
3. **Restart notification-service.**

Recipients are looked up from auth-service at send time. Users whose notification settings turn email off are
skipped. With LocalStack you can see what was sent at `http://localhost:4566/_aws/ses`.

## Dead-lettered events

Event consumers don't retry failures forever. A failed message moves to a dead-letter queue:

| Queue | Receives failures from |
| --- | --- |
| `booking.dead-letter` | flight-service seat events, booking-service's `payment.completed` and seat-rejection consumers, booking's outbox |
| `notification-service.dead-letter` | notification consumers, e.g. SES or auth lookup failures |

**Check the counts:**

```bash
docker exec flight-booking-rabbitmq rabbitmqctl list_queues name messages | grep dead-letter
```

**Replay after fixing the cause.** Consumers are idempotent, so replaying a message twice is safe:

```bash
npm run dlq:replay -- --queue booking.dead-letter                      # dry run: list what would be replayed
npm run dlq:replay -- --queue booking.dead-letter --limit 20 --execute
```

- Each message goes back to the exchange and routing key it originally came from, read from its `x-death` header.
- Messages without that header can't be routed back and are listed as `skip`. These are booking's outbox DLQ
  publishes; inspect them in the RabbitMQ UI at `http://localhost:15672`.
- A message that fails again simply returns to the dead-letter queue.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| A service exits at startup with `PRECONDITION_FAILED - inequivalent arg …` | A queue still has its old arguments | Rollout step 2 (RPC queues), or delete the named queue and restart |
| `POST /bookings` returns 503 | booking couldn't get an answer from flight-service within 5s | Check flight-service health and that `flight_queue` has a consumer. The booking was cancelled, nothing was charged, and any seats taken are released automatically |
| `POST /bookings` returns 409 | Not enough seats, or an unknown flight or seat class | Expected business outcome |
| Admin routes return 403 | The account's `users.role` isn't `admin` | [Grant admin access](#granting-admin-access) |
| booking-service logs `refund required` | A payment arrived for a cancelled booking (only possible for reservations queued before this release) | Refund it manually with `POST /api/v1/payments/refunds` as an admin |
| `booking.dead-letter` keeps growing | A consumer keeps failing | Read the failing service's logs, fix the cause, then [replay](#dead-lettered-events) |
| No emails sent | `NOTIFICATION_PROVIDER` isn't `ses`, the sender isn't verified, or the user opted out | Check notification-service logs and the dead-letter queue |
