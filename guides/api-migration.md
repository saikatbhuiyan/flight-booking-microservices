# API migration guide

For anyone calling the flight-booking API from a web app, mobile app or script. This release closes several security
holes, and some calls that used to work now fail by design. Work through the checklist, then use the reference
sections.

## Checklist

- [ ] Call only the gateway: `http://<host>:3000/api/v1/...`. Service ports 3001–3005 no longer serve business routes.
- [ ] Move payment calls from `/payment-intents` and `/refunds` to `/api/v1/payments`.
- [ ] Stop sending `userId` in the logout body.
- [ ] Handle **409** and **503** from `POST /bookings`.
- [ ] Stop creating payment intents yourself; `POST /bookings` returns the one to confirm.
- [ ] Use an account with the `admin` role for admin routes. They used to return 403 for everyone.

## Basics

- **Auth:** `Authorization: Bearer <accessToken>`. Web clients can rely on the cookies set by `/auth/login`.
- **Success envelope:**

  ```json
  { "success": true, "data": { "...": "..." }, "message": "Booking initiated successfully", "code": "booking.create.success" }
  ```

- **Error envelope:**

  ```json
  { "success": false, "statusCode": 404, "code": "resource.not_found", "message": "Payment not found",
    "timestamp": "…", "correlationId": "…", "path": "/api/v1/payments/…" }
  ```

- **Branch on `statusCode` and `code`,** not on `message`. Messages can change.

## What changed

### 1. Service ports no longer serve business routes

**Before:** `GET http://localhost:3002/api/v1/cities`, `POST http://localhost:3005/payment-intents`, and similar
calls worked without authentication.
**Now:** they return **404**. Every business operation is available through the gateway, which applies
authentication, roles and rate limits. Only `/api/v1/health` remains on the service ports.

### 2. Payments moved to `/api/v1/payments`

| Before (payment-service, no auth) | Now (gateway) | Who |
| --- | --- | --- |
| `POST /payment-intents` | removed; `POST /bookings` creates the intent | — |
| `GET /payment-intents/:id` | `GET /payments/:id` | owner or admin |
| `POST /payment-intents/:id/confirm` | `POST /payments/:id/confirm` (optional `idempotency-key` header) | owner or admin |
| `GET /payment-intents/booking/:bookingId` | `GET /payments/booking/:bookingId` | owner or admin |
| `GET /refunds?bookingId=…` | `GET /payments/booking/:bookingId/refunds` | owner or admin |
| `POST /refunds` | `POST /payments/refunds` (optional `idempotency-key` header) | admin |
| `GET /payment-intents/ledger/entries` | `GET /payments/ledger/entries` | admin |

Some details:

- **Payment ids are UUIDs.** Anything else returns 400.
- **Other users' payments return 404,** not 403.
- **`POST /payments/refunds` body:** `{ "paymentId": "<uuid>", "bookingId": 123, "amount": 5000, "reason": "…" }`.
  `amount` is in cents and must be at least 1.

### 3. Logout no longer takes `userId`

**Before:** `POST /api/v1/auth/logout` with `{ "userId": 42, "deviceId": "…", "clientType": "web" }`. The body's
`userId` decided whose session ended, so anyone could log anyone out.
**Now:** send `{ "deviceId": "…", "clientType": "web" }`. The user comes from your access token. A body containing
`userId` returns **400** (`property userId should not exist`).

### 4. `POST /bookings` confirms seats before returning

The booking flow now asks flight-service to reserve the seats before it creates the payment. The response shape is
unchanged:

```json
{
  "success": true,
  "data": {
    "bookingId": "…", "status": "PENDING", "expiresAt": "…", "totalCost": 199.99,
    "paymentRequired": true, "autoCompleted": false,
    "payment": { "paymentId": "…", "clientSecret": "…", "provider": "payment-service", "status": "…" }
  }
}
```

New outcomes to handle:

| Status | Meaning | What to do |
| --- | --- | --- |
| **409** | The seats aren't available, e.g. "Not enough seats. Requested: 5, Available: 1". The booking was cancelled. | Show the message and let the user change the request. |
| **503** | Seat availability couldn't be confirmed in time. The booking was cancelled and nothing was charged. | Ask the user to retry. |
| **400** | Invalid input. `seatNumbers` must now be an array of strings. | Fix the request. |

`totalCost` now comes from the flight's fare for the seat class. It used to be `0`.

### 5. Admin routes work for admins only

Routes marked admin below used to return **403 for everyone**, because the role check never saw a role. They now
work for users whose role is `admin`; an operator grants it. Access tokens no longer carry a role; it is read from
the user record on every request, so a role change takes effect immediately.

New admin routes: `GET /cities/with-airport-count` and `PATCH /cities/:id/restore`. `GET /airports/statistics` now
returns real statistics; it used to return the airport list.

### 6. Booking emails (optional)

When the operator enables email, users receive messages for booking confirmed, booking cancelled (including the
reason, e.g. seats unavailable) and payment failed. There's nothing to change on the client side.

## Route reference

| Area | Public | Signed-in user | Admin |
| --- | --- | --- | --- |
| Auth `/auth` | `POST register`, `POST login`, `POST refresh` | `POST logout`, `GET me` | |
| Flights `/flights` | `GET /`, `GET /:id` | | `POST /`, `DELETE /:id` |
| Cities `/cities` | `GET /`, `GET /:id` | | `POST /`, `PATCH /:id`, `DELETE /:id`, `GET statistics`, `GET with-airport-count`, `PATCH /:id/restore` |
| Airports `/airports` | `GET /`, `GET search`, `GET /:id` | | `POST /`, `PATCH /:id`, `DELETE /:id`, `GET statistics` |
| Airplanes `/airplanes` | `GET /`, `GET /:id` | | `POST /`, `PATCH /:id`, `DELETE /:id` |
| Seats `/seats` | `GET airplane/:airplaneId` | | `POST /`, `POST bulk`, `DELETE /:id` |
| Bookings `/bookings` | | `POST /`, `POST /:id/complete`, `PUT /:id/cancel`, `PUT /:id/extend`, `GET my-bookings`, `GET /:id`, `GET flights/:flightId/seats/availability` | |
| Payments `/payments` | | `GET /:id`, `POST /:id/confirm`, `GET booking/:bookingId`, `GET booking/:bookingId/refunds` (own only) | `POST refunds`, `GET ledger/entries` |

Rate limits apply per user, or per IP when signed out:

- **Booking:** create 3 per minute (then blocked for 5 minutes), complete and cancel 5 per minute, extend 2 per
  minute.
- **Payments:** confirm and refund 5 per minute.
- **Auth routes:** 5 per minute.

The full schema is in Swagger at `http://<host>:3000/api/docs`.
