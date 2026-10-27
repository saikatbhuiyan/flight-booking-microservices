# Flight Booking Microservices

NestJS-based flight booking platform built as a multi-service system with RabbitMQ, PostgreSQL, Redis, LocalStack S3, and OpenTelemetry. The repository is structured for both engineering review and hands-on local development.

## What This Project Shows

- Microservice decomposition with an API gateway and service-specific responsibilities
- Mixed sync/async communication using HTTP and RabbitMQ
- Database-per-service boundaries with shared platform libraries
- Booking reliability patterns such as idempotency, seat locking, audit logs, and compensation events
- Dev tooling for local containers, Swagger, health checks, tracing, and message-driven workflows

## System Overview

```text
Client
  |
  v
API Gateway (3000)
  |
  +--> Auth Service (3001)
  +--> Flight Service (3002)
  +--> Booking Service (3003)
  +--> Notification Service (3004)
  +--> Payment Service (3005)

Shared infrastructure
  - PostgreSQL
  - Redis
  - RabbitMQ
  - LocalStack S3
  - Tempo / Jaeger / Grafana
```

## Services

| Service | Port | Responsibility |
| --- | ---: | --- |
| API Gateway | 3000 | Public HTTP entrypoint, auth, request validation, rate limiting, API composition |
| Auth Service | 3001 | User authentication, JWT flows, refresh tokens, RBAC support |
| Flight Service | 3002 | Flights, cities, airports, airplanes, seats, seat inventory changes |
| Booking Service | 3003 | Booking lifecycle, saga orchestration, payment handoff, local payment fallback |
| Notification Service | 3004 | Event-driven booking notifications |
| Payment Service | 3005 | Payment intents, capture, refunds, ledgers, webhook handling |

## Shared Libraries

| Library | Purpose |
| --- | --- |
| `@app/common` | DTOs, decorators, filters, guards, interceptors, logging, Redis helpers |
| `@app/database` | TypeORM setup and per-service data source configuration |
| `@app/message-broker` | RabbitMQ integration helpers |
| `@app/rate-limiter` | Shared rate limiting module and guard |
| `@app/seat-lock` | Redis-backed distributed seat lock logic |
| `@app/storage` | Storage abstraction for S3 / LocalStack |
| `@app/telemetry` | OpenTelemetry bootstrap and tracing helpers |

## Key Technical Patterns

- Database-per-service isolation
- Event-driven workflows with RabbitMQ
- Idempotency keys for payment and booking-sensitive flows
- Redis-backed distributed locking for seat reservation windows
- Audit logging and ledger tracking in the payment domain
- OpenTelemetry tracing with Tempo and Jaeger
- Docker Compose workflow for local infrastructure

## Local Development

### Prerequisites

- Node.js 18+
- npm
- Docker Desktop or Docker Engine with Compose
- AWS CLI if you want to create the LocalStack S3 bucket via script

### 1. Install dependencies

```bash
npm install
```

### 2. Start infrastructure

```bash
docker-compose up -d postgres redis rabbitmq localstack tempo jaeger grafana
```

### 3. Create the local S3 bucket

```bash
npm run setup:localstack
```

### 4. Start the services

Run everything:

```bash
npm run start:all
```

Or run only the service you need:

```bash
npm run start:api-gateway
npm run start:auth
npm run start:flight
npm run start:booking
npm run start:notification
npm run start:payment
```

## Useful Commands

```bash
npm run build
npm run lint:check
npm test
npm run test:e2e
npm run docker:up
npm run docker:down
```

## Local URLs

| Tool | URL |
| --- | --- |
| API Gateway | `http://localhost:3000` |
| Swagger Docs | `http://localhost:3000/api/docs` |
| RabbitMQ UI | `http://localhost:15672` |
| Jaeger UI | `http://localhost:16686` |
| Grafana | `http://localhost:3006` |
| Tempo | `http://localhost:3200` |
| LocalStack | `http://localhost:4566` |

RabbitMQ default credentials:

```text
username: admin
password: admin
```

## Repository Layout

```text
apps/
  api-gateway/
  auth-service/
  booking-service/
  flight-service/
  notification-service/
  payment-service/
libs/
  common/
  database/
  message-broker/
  rate-limiter/
  seat-lock/
  storage/
  telemetry/
docs/
docker-compose.yml
nest-cli.json
```

## Suggested Reviewer Walkthrough

If you are evaluating the project, these are the fastest places to get signal:

1. Start with `apps/api-gateway` to understand the public entrypoint.
2. Open `apps/booking-service` to see orchestration and downstream coordination.
3. Review `apps/payment-service` for idempotency, ledgering, refunds, and audit logging.
4. Review `libs/seat-lock` for concurrency handling around seat reservation windows.
5. Check `libs/telemetry` and `docker-compose.yml` for the observability setup.

## Notes for Developers

- Top-level `npm run build` targets the default Nest project defined in `nest-cli.json`.
- Each service has its own `tsconfig.app.json` and can be started independently.
- Each service now loads its own `apps/<service>/.env` file even when started from the monorepo root.
- Some lint warnings still exist in older parts of the codebase, but the repo now builds cleanly and the root scripts point at real apps.
- Stripe is the production-ready payment path in this repo. PayPal is registered but intentionally returns `NotImplemented`.
- RPC queue options live in `libs/common/src/rmq/rpc-queue.ts` and are shared by services and their clients.

### One-time migration: RPC queue arguments changed

The RPC queues (`<service>_queue`) no longer carry dead-letter/retry arguments. A broker that still has the old
queues rejects the new declaration with `PRECONDITION_FAILED - inequivalent arg 'x-dead-letter-exchange'` and the
service fails to start. Delete the old queues once (RPC requests are transient, nothing durable is lost):

```bash
docker exec flight-booking-rabbitmq sh -c 'for s in auth flight booking notification payment; do
  for q in ${s}_queue ${s}_queue_retry ${s}_queue_dead; do rabbitmqctl -q delete_queue "$q" || true; done
done'
```

## Booking Flow Without Payment Service

For local development, `booking-service` can finish the full booking flow without `payment-service`.

- In development, `booking-service` defaults to a local mock payment mode when `PAYMENT_REQUIRED` is not set.
- You can make that behavior explicit by setting `PAYMENT_REQUIRED=false` in your local `apps/booking-service/.env`.
- In that mode, `POST /bookings` still runs the booking saga, then auto-confirms the booking with a generated local transaction id.
- The response includes `paymentRequired`, `autoCompleted`, and `payment.provider` so the caller can tell whether the booking used the real payment-service or the local mock path.
- To test the real RMQ payment path locally, set `PAYMENT_REQUIRED=true` in `apps/booking-service/.env` and start `payment-service`.

## Current Status

This repository is a strong backend architecture project with practical patterns for:

- service separation
- async communication
- infrastructure-backed local development
- payment and booking reliability concerns
- observability and operational thinking

It is a good portfolio or interview project because it shows both application logic and platform engineering decisions in one codebase.

### Start all services with Docker Compose
```bash
docker-compose up --build
```

### Stop all services
```bash
docker-compose down
```

### View logs
```bash
docker-compose logs -f [service-name]
```

## 📚 API Documentation

Once the API Gateway is running, access Swagger documentation at:
```
http://localhost:3000/api/docs
```

### Authentication Endpoints
```
POST /api/v1/auth/register    - Register new user
POST /api/v1/auth/login       - Login user
POST /api/v1/auth/refresh     - Refresh access token
GET  /api/v1/auth/me          - Get current user profile
```

### Flight Endpoints
```
GET    /api/v1/flights              - List all flights
GET    /api/v1/flights/search       - Search flights
GET    /api/v1/flights/:id          - Get flight by ID
POST   /api/v1/flights              - Create flight (Admin)
PUT    /api/v1/flights/:id          - Update flight (Admin)
DELETE /api/v1/flights/:id          - Delete flight (Admin)
POST   /api/v1/flights/:id/image    - Upload flight image (Admin)
```

### Booking Endpoints
```
GET  /api/v1/bookings              - List all bookings (Admin)
GET  /api/v1/bookings/my-bookings  - Get user bookings
GET  /api/v1/bookings/:id          - Get booking by ID
POST /api/v1/bookings              - Create booking
PUT  /api/v1/bookings/:id/cancel   - Cancel booking
```

## 🔐 Security Features

1. **JWT Authentication**
   - Access tokens (15 minutes)
   - Refresh tokens (7 days)
   - Token blacklisting with Redis

2. **Password Security**
   - Bcrypt hashing (10 rounds)
   - Password complexity requirements
   - Secure password storage

3. **Rate Limiting**
   - 10 requests per minute per IP
   - Configurable throttle settings

4. **Input Validation**
   - Class-validator for DTO validation
   - Whitelist and sanitization
   - Type transformation

5. **CORS & Helmet**
   - Cross-origin resource sharing
   - Security headers
   - XSS protection

## 🔄 Dependency Inversion Examples

### Switching Storage Provider

The storage module uses dependency inversion, making it easy to switch providers:

```typescript
// Using S3
StorageModule.forRoot({
  useClass: S3StorageProvider,
});

// Switching to Google Cloud Storage
StorageModule.forRoot({
  useClass: GCSStorageProvider,
});

// Using custom provider
StorageModule.forRoot({
  useFactory: () => new CustomStorageProvider(),
});
```

### Switching Message Broker

Similarly, you can switch from RabbitMQ to any other message broker:

```typescript
// Using RabbitMQ
MessageBrokerModule.forRoot({
  useClass: RabbitMQProvider,
});

// Switching to Apache Kafka
MessageBrokerModule.forRoot({
  useClass: KafkaProvider,
});
```

## 🧪 Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## 📊 Database Migrations

The system uses a "database-per-service" architecture. Each service has its own PostgreSQL database and migration folder.

### 🔑 Auth Service (`auth_db`)
```bash
# Generate migration from schema changes
npm run migration:generate:auth -- apps/auth-service/src/migrations/MigrationName

# Create empty migration
npm run migration:create:auth -- apps/auth-service/src/migrations/MigrationName

# Run migrations
npm run migration:run:auth

# Revert migration
npm run migration:revert:auth
```

### ✈️ Flight Service (`flight_db`)

```bash
docker exec -it flight-booking-postgres psql -U postgres -d postgres -c "CREATE DATABASE booking_db;"
# Generate migration from schema changes
npm run migration:generate:flight -- apps/flight-service/src/migrations/MigrationName

# Create empty migration
npm run migration:create:flight -- apps/flight-service/src/migrations/MigrationName

# Run migrations
npm run migration:run:flight

# Revert migration
npm run migration:revert:flight
```

### 📅 Booking Service (`booking_db`)
```bash
# Generate migration from schema changes
npm run migration:generate:booking -- apps/booking-service/src/migrations/MigrationName

# Create empty migration
npm run migration:create:booking -- apps/booking-service/src/migrations/MigrationName

# Run migrations
npm run migration:run:booking

# Revert migration
npm run migration:revert:booking
```

> [!IMPORTANT]
> When running `generate` or `create` commands, ensure you provide the full path including the folder (e.g., `apps/service-name/src/migrations/Name`) so TypeORM places the file in the correct location.

> [!TIP]
> **Running migrations from your host machine:**
> The `.env` files point to `DB_HOST=postgres` for Docker networking. When running migrations from your terminal (host machine), you may need to override the host:
> ```bash
> DB_HOST=localhost npm run migration:run:flight
> ```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| **Application** |
| NODE_ENV | Environment | development |
| PORT | Service port | 3000-3004 |
| **Database** |
| DB_HOST | PostgreSQL host | postgres (Docker) / localhost |
| DB_PORT | PostgreSQL port | 5432 |
| DB_USERNAME | Database user | postgres |
| DB_PASSWORD | Database password | postgres |
| DB_NAME | Database name | auth_db/flight_db/booking_db |
| **Redis** |
| REDIS_HOST | Redis host | redis (Docker) / localhost |
| REDIS_PORT | Redis port | 6379 |
| **RabbitMQ** |
| RABBITMQ_URL | RabbitMQ URL | amqp://admin:admin@rabbitmq:5672 |
| **Booking/Payment** |
| PAYMENT_REQUIRED | If false, booking auto-completes with mock payment. If unset, development defaults to local mock and production defaults to real payment-service. | false in local dev |
| PAYMENT_QUEUE | RMQ queue name for payment-service RPC | payment_queue |
| **JWT** |
| JWT_ACCESS_SECRET | JWT access secret | (required) |
| JWT_REFRESH_SECRET | JWT refresh secret | (required) |
| JWT_ACCESS_EXPIRATION | Access token expiry | 15m |
| JWT_REFRESH_EXPIRATION | Refresh token expiry | 7d |
| **AWS S3** |
| AWS_REGION | AWS region | us-east-1 |
| AWS_ACCESS_KEY_ID | AWS access key | test (LocalStack) |
| AWS_SECRET_ACCESS_KEY | AWS secret key | test (LocalStack) |
| AWS_S3_BUCKET | S3 bucket name | flight-booking-bucket |
| AWS_ENDPOINT | S3 endpoint | http://localstack:4566 |
| **Observability** |
| OTEL_EXPORTER_OTLP_ENDPOINT | OpenTelemetry endpoint | http://tempo:4318/v1/traces |
| **Rate Limiting** |
| THROTTLE_TTL | Rate limit window (seconds) | 60 |
| THROTTLE_LIMIT | Max requests per window | 10 |
| **CORS** |
| CORS_ORIGIN | Allowed origins | http://localhost:3000 |

## 🏗️ Project Structure

```
flight-booking/
├── apps/
│   ├── api-gateway/              # HTTP Gateway (Port 3000)
│   │   ├── src/
│   │   │   ├── controllers/      # Route controllers
│   │   │   ├── guards/           # JWT auth guards
│   │   │   └── main.ts           # Bootstrap
│   │   ├── Dockerfile
│   │   └── .env
│   ├── auth-service/             # Authentication (Port 3001)
│   │   ├── src/
│   │   │   ├── entities/         # User entity
│   │   │   ├── services/         # Auth logic
│   │   │   ├── strategies/       # Passport strategies
│   │   │   └── migrations/       # Database migrations
│   │   └── .env
│   ├── flight-service/           # Flight management (Port 3002)
│   │   ├── src/
│   │   │   ├── entities/         # Flight, Airport, Seat entities
│   │   │   ├── services/         # Flight CRUD, search
│   │   │   └── migrations/       # Database migrations
│   │   └── .env
│   ├── booking-service/          # Booking management (Port 3003)
│   │   ├── src/
│   │   │   ├── entities/         # Booking, Payment entities
│   │   │   ├── services/         # Booking logic, seat locking
│   │   │   └── migrations/       # Database migrations
│   │   └── .env
│   └── notification-service/     # Notifications (Port 3004)
│       ├── src/
│       │   ├── services/         # Email, SMS services
│       │   └── listeners/        # Event listeners
│       └── .env
├── libs/
│   ├── common/                   # Shared utilities
│   │   ├── decorators/           # @User, @Roles, @Public
│   │   ├── dto/                  # Shared DTOs
│   │   ├── enums/                # Common enums
│   │   ├── filters/              # Global exception filter
│   │   ├── guards/               # Auth, role guards
│   │   ├── health/               # Health check indicators
│   │   ├── interceptors/         # Logging, metrics, response wrapping
│   │   ├── middleware/           # Correlation ID middleware
│   │   └── services/             # Shared business logic
│   ├── database/                 # TypeORM configuration
│   │   └── data-sources/         # Per-service data sources
│   ├── message-broker/           # RabbitMQ abstraction
│   ├── storage/                  # S3/LocalStack abstraction
│   ├── rate-limiter/             # Custom rate limiting
│   ├── seat-lock/                # Distributed seat locking
│   └── telemetry/                # OpenTelemetry integration
├── docker-compose.yml            # Docker orchestration
├── tempo.yaml                    # Tempo configuration
├── init-db.sql                   # Database initialization
├── .env                          # Environment variables
├── nest-cli.json                 # NestJS CLI config
├── tsconfig.json                 # TypeScript config
└── package.json                  # Dependencies & scripts
```

## 🚦 Service Health Checks

Each service exposes health check endpoints:

```
GET /health
```

## 📊 Observability & Monitoring

### Distributed Tracing

The system uses **OpenTelemetry** for distributed tracing with **Tempo** as the backend and **Jaeger/Grafana** for visualization.

**How it works:**
1. Each request gets a unique **Correlation ID** via middleware
2. OpenTelemetry automatically instruments HTTP requests, database queries, and RabbitMQ messages
3. Traces are exported to Tempo via OTLP (OpenTelemetry Protocol)
4. View traces in Jaeger UI at `http://localhost:16686`

**Viewing Traces:**
```bash
# Access Jaeger UI
open http://localhost:16686

# Access Grafana (configure Tempo data source)
open http://localhost:3005
```

### Correlation ID Tracking

Every request is assigned a correlation ID that flows through:
- HTTP requests (via `X-Correlation-ID` header)
- RabbitMQ messages (via message properties)
- Database queries (via logging context)
- Error responses (included in error payload)

**Example:**
```bash
curl -H "X-Correlation-ID: my-custom-id" http://localhost:3000/api/v1/flights
```

### Structured Logging

- **Winston** for structured JSON logging
- **Daily rotate files** for log management
- **Correlation IDs** in every log entry
- **Log levels:** error, warn, info, debug

**Log format:**
```json
{
  "timestamp": "2026-02-15T23:46:56.000Z",
  "level": "info",
  "correlationId": "abc-123-def",
  "service": "booking-service",
  "message": "Booking created successfully",
  "context": { "bookingId": "uuid" }
}
```

### Health Checks

All services expose health check endpoints:

```bash
# API Gateway
GET http://localhost:3000/health

# Individual services
GET http://localhost:3001/health  # Auth
GET http://localhost:3002/health  # Flight
GET http://localhost:3003/health  # Booking
GET http://localhost:3004/health  # Notification
```

**Health indicators:**
- Database connectivity
- Redis connectivity
- RabbitMQ connectivity
- Memory usage
- Disk space

### Metrics Collection

Custom metrics interceptor tracks:
- Request duration
- Response status codes
- Error rates
- RPC call latency

## 🔒 Advanced Features Deep Dive

### Seat Locking for Concurrent Bookings

The `@app/seat-lock` library prevents double-booking using Redis distributed locks:

**How it works:**
1. User selects seats → System acquires Redis lock
2. Lock held for 10 minutes (configurable)
3. Booking completed → Lock released
4. Lock expires → Seats become available again

**Implementation:**
```typescript
// Automatically handled in booking service
await this.seatLockService.lockSeats(flightId, seatNumbers);
try {
  await this.createBooking(...);
} finally {
  await this.seatLockService.unlockSeats(flightId, seatNumbers);
}
```

### Idempotency Support

Critical operations (bookings, payments) support idempotency keys:

```bash
POST /api/v1/bookings
Headers:
  X-Idempotency-Key: unique-key-123
  
# Duplicate request with same key returns original response
```

### Global Exception Handling

Standardized error responses across all services:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "correlationId": "abc-123-def",
  "timestamp": "2026-02-15T23:46:56.000Z",
  "path": "/api/v1/bookings",
  "details": []
}
```

## 🐛 Troubleshooting

### Port Conflicts

**Problem:** `Bind for 0.0.0.0:4317 failed: port is already allocated`

**Solution:**
```bash
# Find process using the port
lsof -i :4317

# Kill the process
kill -9 <PID>

# Or change port in docker-compose.yml
```

### Migration Issues

**Problem:** `QueryFailedError: relation already exists`

**Solution:** All migrations are idempotent. Safe to re-run:
```bash
npm run migration:run:booking
```

### Database Connection Errors

**Problem:** `ECONNREFUSED` when connecting to PostgreSQL

**Solution:**
```bash
# From host machine, use localhost
DB_HOST=localhost npm run migration:run:flight

# From Docker, use service name
DB_HOST=postgres npm run start:flight
```

### RabbitMQ Connection Issues

**Problem:** Services can't connect to RabbitMQ

**Solution:**
```bash
# Check RabbitMQ is running
docker-compose ps rabbitmq

# View RabbitMQ logs
docker-compose logs rabbitmq

# Restart RabbitMQ
docker-compose restart rabbitmq
```

### Seat Locking Issues

**Problem:** Seats remain locked after failed booking

**Solution:** Locks auto-expire after 10 minutes, or manually clear:
```bash
# Connect to Redis
docker exec -it flight-booking-redis redis-cli

# List all locks
KEYS seat:lock:*

# Delete specific lock
DEL seat:lock:flight-123:A1
```

### Viewing Logs with Correlation IDs

```bash
# Follow logs for a specific service
docker-compose logs -f booking-service

# Search logs by correlation ID
docker-compose logs | grep "abc-123-def"
```

## 💻 Development Workflow

### Local Development (Without Docker)

1. **Start infrastructure services:**
```bash
docker-compose up -d postgres redis rabbitmq localstack
```

2. **Setup LocalStack S3:**
```bash
npm run setup:localstack
```

3. **Run migrations:**
```bash
DB_HOST=localhost npm run migration:run:auth
DB_HOST=localhost npm run migration:run:flight
DB_HOST=localhost npm run migration:run:booking
```

4. **Start services:**
```bash
# All services
npm run start:all

# Or individually
npm run start:api-gateway
npm run start:auth
npm run start:flight
npm run start:booking
npm run start:notification
npm run start:payment
```

#### Running locally without `payment-service`

Set this in your local `apps/booking-service/.env` if you want to skip `payment-service`:

```bash
PAYMENT_REQUIRED=false
```

Start `booking-service` normally and booking creation will auto-complete after the saga finishes.

If you want to switch back to the real payment-service path, set:

```bash
PAYMENT_REQUIRED=true
```

and start `payment-service` as well.

### Docker Development

```bash
# Build and start all services
docker-compose up --build

# Start in detached mode
docker-compose up -d

# View logs
docker-compose logs -f [service-name]

# Restart a service
docker-compose restart booking-service

# Stop all services
docker-compose down

# Remove volumes (clean slate)
docker-compose down -v
```

### Debugging with Distributed Tracing

1. Make a request and note the correlation ID:
```bash
curl -v http://localhost:3000/api/v1/bookings
# Response header: X-Correlation-ID: abc-123-def
```

2. Search for the trace in Jaeger:
   - Open `http://localhost:16686`
   - Select service: `api-gateway`
   - Search by correlation ID or time range
   - View full request flow across services

### Testing Microservice Communication

```bash
# Test RabbitMQ message flow
# 1. Create a booking via API Gateway
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{...}'

# 2. Check notification service logs
docker-compose logs notification-service | grep "booking.created"

# 3. Verify in RabbitMQ UI
open http://localhost:15672
```

### Creating Migrations

```bash
# Generate migration from entity changes
npm run migration:generate:booking -- apps/booking-service/src/migrations/AddPaymentStatus

# Create empty migration
npm run migration:create:booking -- apps/booking-service/src/migrations/CustomMigration

# Run migrations
npm run migration:run:booking

# Revert last migration
npm run migration:revert:booking
```

### Best Practices

1. **Always use correlation IDs** when debugging cross-service issues
2. **Check health endpoints** before debugging service issues
3. **Use Jaeger UI** to visualize request flows
4. **Monitor RabbitMQ queues** for message backlogs
5. **Check Redis** for lock issues in concurrent scenarios
6. **Run migrations** before starting services after entity changes
7. **Use idempotency keys** for testing booking operations

## 📈 Performance & Scalability

### Caching Strategy

- **Flight search results** cached in Redis (5 minutes TTL)
- **User sessions** stored in Redis
- **Rate limiting** counters in Redis
- **Seat locks** managed via Redis distributed locks

### Database Optimization

- **Indexes** on frequently queried fields
- **Connection pooling** for efficient resource usage
- **Database-per-service** for independent scaling
- **Read replicas** support (configurable)

### Horizontal Scaling

All services are stateless and can be scaled horizontally:

```yaml
# docker-compose.yml
booking-service:
  deploy:
    replicas: 3
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📝 License

This project is licensed under the MIT License.

## 🎯 Roadmap

### Short Term
- [ ] Email templates with SendGrid
- [ ] SMS integration with Twilio

### Medium Term
- [ ] Flight tracking and status updates
- [ ] Loyalty program integration
- [ ] Analytics and reporting dashboard

### Long Term
- [ ] Kubernetes deployment with Helm charts
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Multi-region deployment
- [ ] Real-time notifications via WebSockets
