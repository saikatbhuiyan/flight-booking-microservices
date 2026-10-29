import { ConflictException, HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Booking, BookingStatus, PaymentStatus } from '../entities/booking.entity';
import { SagaState, SagaStatus } from '../entities/saga-state.entity';
import { SeatLockService } from '@app/seat-lock';
import { OutboxService } from '../outbox/outbox.service';
import { v4 as uuidv4 } from 'uuid';
import { trace, context as otelContext, SpanStatusCode } from '@opentelemetry/api';
import { EventPatterns, MessagePatterns, ReserveFlightSeatsDto, createHttpExceptionFromRpcError } from '@app/common';

export interface CreateBookingDto {
  userId: number;
  flightId: string | number;
  seats: number;
  seatNumbers?: string[];
  seatClass?: string;
  totalCost?: number;
  passengerName?: string;
  passengerEmail?: string;
  passengerPhone?: string;
  seatPreference?: string;
}

export const FLIGHT_CLIENT = 'FLIGHT_SERVICE';

/** How long the saga waits for flight-service to confirm seats before compensating. */
const FLIGHT_RESERVATION_TIMEOUT_MS = 5000;

const CANCELLED_SAGA_STATUSES = [SagaStatus.COMPENSATING, SagaStatus.COMPENSATED, SagaStatus.FAILED];

@Injectable()
export class BookingSagaOrchestrator {
  private readonly logger = new Logger(BookingSagaOrchestrator.name);
  private readonly tracer = trace.getTracer('booking-service');

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(SagaState)
    private readonly sagaStateRepository: Repository<SagaState>,
    private readonly seatLockService: SeatLockService,
    private readonly outboxService: OutboxService,
    private readonly dataSource: DataSource,
    @Inject(FLIGHT_CLIENT) private readonly flightClient: ClientProxy,
  ) {}

  /**
   * Execute booking saga with persistence and idempotency
   */
  async executeBookingSaga(dto: CreateBookingDto, idempotencyKey?: string): Promise<Booking> {
    const span = this.tracer.startSpan('saga.executeBooking', {
      attributes: {
        'booking.flight_id': dto.flightId,
        'booking.user_id': dto.userId,
      },
    });

    try {
      // Check idempotency
      if (idempotencyKey) {
        const existingSaga = await this.sagaStateRepository.findOne({
          where: { idempotencyKey },
        });

        if (existingSaga) {
          this.logger.log(`Saga already exists for idempotency key: ${idempotencyKey}`);
          const booking = await this.bookingRepository.findOne({
            where: { bookingReference: existingSaga.bookingId },
          });
          span.end();
          return booking;
        }
      }

      const sagaId = uuidv4();
      const bookingId = uuidv4();

      // Create saga state
      const sagaState = await this.sagaStateRepository.save({
        sagaId,
        sagaType: 'CREATE_BOOKING',
        bookingId,
        status: SagaStatus.INITIATED,
        currentStep: 0,
        payload: dto,
        context: {},
        idempotencyKey,
      });

      // Execute steps
      await otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
        await this.executeStep1_CreateBooking(sagaState);
        await this.executeStep2_LockSeats(sagaState);
        await this.executeStep3_ReserveFlightSeats(sagaState);
      });

      const booking = await this.bookingRepository.findOne({
        where: { bookingReference: bookingId },
      });

      span.setStatus({ code: SpanStatusCode.OK });
      return booking;
    } catch (error) {
      this.logger.error('Saga execution failed:', error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Step 1: Create Booking (Idempotent with transaction)
   */
  private async executeStep1_CreateBooking(sagaState: SagaState): Promise<void> {
    const span = this.tracer.startSpan('saga.step1.createBooking');

    try {
      if (sagaState.currentStep >= 1) {
        this.logger.log('Step 1 already completed (idempotent)');
        span.end();
        return;
      }

      await this.dataSource.transaction(async (manager) => {
        const dto = sagaState.payload as CreateBookingDto;

        // Resolve seat class: specific seatClass > seatPreference (if it's a valid class) > ECONOMY
        const seatClasses = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST_CLASS'];
        let resolvedSeatClass = dto.seatClass || 'ECONOMY';

        if (!dto.seatClass && dto.seatPreference) {
          const upperPreference = dto.seatPreference.toUpperCase();
          if (seatClasses.includes(upperPreference)) {
            resolvedSeatClass = upperPreference;
          }
        }

        const booking = manager.create(Booking, {
          bookingReference: sagaState.bookingId,
          userId: dto.userId,
          flightId: Number(dto.flightId),
          noOfSeats: dto.seats || (dto.seatNumbers ? dto.seatNumbers.length : 1),
          seatNumbers: dto.seatNumbers || [],
          seatClass: resolvedSeatClass,
          totalCost: dto.totalCost || 0,
          passengerName: dto.passengerName || 'Unknown',
          passengerEmail: dto.passengerEmail || '',
          passengerPhone: dto.passengerPhone || '',
          status: BookingStatus.INITIATED,
          paymentStatus: PaymentStatus.PENDING,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        });

        await manager.save(Booking, booking);

        // Update saga state
        sagaState.currentStep = 1;
        sagaState.status = SagaStatus.INITIATED;
        await manager.save(SagaState, sagaState);

        // Store event in outbox (same transaction)
        await this.outboxService.storeEvent(
          'BOOKING',
          sagaState.bookingId,
          EventPatterns.BOOKING_CREATED,
          { bookingId: sagaState.bookingId, userId: dto.userId },
          manager,
        );
      });

      this.logger.log(`Step 1 completed: Booking ${sagaState.bookingId} created`);
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Step 2: Lock Seats (Idempotent)
   */
  private async executeStep2_LockSeats(sagaState: SagaState): Promise<void> {
    const span = this.tracer.startSpan('saga.step2.lockSeats');

    try {
      if (sagaState.currentStep >= 2) {
        this.logger.log('Step 2 already completed (idempotent)');
        span.end();
        return;
      }

      const dto = sagaState.payload as CreateBookingDto;

      const locked = await this.seatLockService.lockSeats(
        Number(dto.flightId),
        dto.seatNumbers || [],
        sagaState.bookingId,
        dto.userId,
      );

      if (!locked.success) {
        throw new Error(`Failed to lock seats: ${locked.failedSeats.join(', ')}`);
      }

      // Update saga state
      await this.dataSource.transaction(async (manager) => {
        sagaState.currentStep = 2;
        sagaState.status = SagaStatus.SEATS_LOCKED;
        sagaState.context = { ...sagaState.context, lockKey: locked.lockKey };
        await manager.save(SagaState, sagaState);
      });

      this.logger.log('Step 2 completed: Seats locked');
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      await this.compensate(sagaState, error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Step 3: Reserve Flight Seats (synchronous RPC, idempotent per saga)
   *
   * Waits for flight-service so payment is only taken for seats that exist. A rejection (409) cancels the booking
   * without releasing anything; no answer (timeout/transport error) cancels it and sends a release, which flight
   * applies only if the reservation actually happened.
   */
  private async executeStep3_ReserveFlightSeats(sagaState: SagaState): Promise<void> {
    const span = this.tracer.startSpan('saga.step3.reserveFlightSeats');

    try {
      if (sagaState.currentStep >= 3) {
        this.logger.log('Step 3 already completed (idempotent)');
        span.end();
        return;
      }

      const dto = sagaState.payload as CreateBookingDto;
      const reservation: ReserveFlightSeatsDto = {
        reservationId: `${sagaState.sagaId}:reserve-seats`,
        bookingId: sagaState.bookingId,
        flightId: Number(dto.flightId),
        seatClass: dto.seatClass || 'ECONOMY',
        seatCount: dto.seats || (dto.seatNumbers ? dto.seatNumbers.length : 1),
      };

      try {
        await firstValueFrom(
          this.flightClient
            .send(MessagePatterns.FLIGHT_RESERVE_SEATS, reservation)
            .pipe(timeout(FLIGHT_RESERVATION_TIMEOUT_MS)),
        );
      } catch (error) {
        const failure = createHttpExceptionFromRpcError(error);
        const rejected = failure.getStatus() === (HttpStatus.CONFLICT as number);
        const reason = rejected ? failure.message : `Seat reservation unconfirmed: ${failure.message}`;

        await this.compensate(sagaState, new Error(reason), { flightSeatsReserved: !rejected });
        throw rejected
          ? new ConflictException(failure.message)
          : new ServiceUnavailableException('Could not confirm seat availability, please try again');
      }

      await this.dataSource.transaction(async (manager) => {
        sagaState.currentStep = 3;
        sagaState.status = SagaStatus.FLIGHT_RESERVED;
        await manager.save(SagaState, sagaState);

        await manager.update(Booking, { bookingReference: sagaState.bookingId }, { status: BookingStatus.PENDING });
      });

      this.logger.log('Step 3 completed: Flight seats reserved');
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      await this.compensate(sagaState, error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Complete booking after payment
   */
  async completeBooking(bookingId: string, paymentTransactionId: string): Promise<Booking> {
    const span = this.tracer.startSpan('saga.completeBooking');

    try {
      const sagaState = await this.sagaStateRepository.findOne({
        where: { bookingId },
      });

      if (!sagaState) {
        throw new Error('Saga state not found');
      }

      if (CANCELLED_SAGA_STATUSES.includes(sagaState.status)) {
        throw new ConflictException(`Booking ${bookingId} is cancelled and cannot be completed`);
      }

      // Idempotency check
      if (sagaState.status === SagaStatus.BOOKING_CONFIRMED) {
        this.logger.log(`Booking ${bookingId} already confirmed (idempotent)`);
        return await this.bookingRepository.findOne({
          where: { bookingReference: bookingId },
        });
      }

      await this.dataSource.transaction(async (manager) => {
        const dto = sagaState.payload as CreateBookingDto;

        // Store confirm event in outbox
        await this.outboxService.storeEvent(
          'BOOKING',
          bookingId,
          EventPatterns.FLIGHT_CONFIRM_SEATS,
          {
            flightId: Number(dto.flightId), // Coerce to number
            bookingId,
            seatClass: dto.seatClass || 'ECONOMY', // Provide default
            seatCount: dto.seats || (dto.seatNumbers ? dto.seatNumbers.length : 1), // Provide default
          },
          manager,
        );

        // Update booking
        await manager.update(
          Booking,
          { bookingReference: bookingId },
          {
            status: BookingStatus.BOOKED,
            paymentStatus: PaymentStatus.COMPLETED,
            paymentTransactionId,
            paidAt: new Date(),
            expiresAt: null,
          },
        );

        // Update saga state
        sagaState.currentStep = 6;
        sagaState.status = SagaStatus.BOOKING_CONFIRMED;
        await manager.save(SagaState, sagaState);

        // Store notification event
        await this.outboxService.storeEvent(
          'BOOKING',
          bookingId,
          EventPatterns.BOOKING_CONFIRMED,
          { bookingId, userId: dto.userId },
          manager,
        );
      });

      // Release Redis locks (outside transaction)
      const dto = sagaState.payload as CreateBookingDto;
      await this.seatLockService.releaseSeats(Number(dto.flightId), bookingId); // Coerce to number

      span.setStatus({ code: SpanStatusCode.OK });
      return await this.bookingRepository.findOne({
        where: { bookingReference: bookingId },
      });
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Public method to cancel a booking (compensate step 3 down)
   */
  async cancelBooking(bookingId: string, reason: string): Promise<Booking> {
    const sagaState = await this.sagaStateRepository.findOne({
      where: { bookingId },
    });

    if (!sagaState) {
      throw new Error('Saga state not found');
    }

    await this.compensate(sagaState, new Error(reason));

    return await this.bookingRepository.findOne({
      where: { bookingReference: bookingId },
    });
  }

  /**
   * flight-service could not reserve the seats (unknown flight, not enough seats). Cancel the booking without asking
   * flight to release seats it never took. Idempotent: a duplicate rejection finds the saga already COMPENSATED.
   */
  async handleSeatReservationRejected(bookingId: string, reason: string): Promise<void> {
    const sagaState = await this.sagaStateRepository.findOne({ where: { bookingId } });

    if (!sagaState) {
      this.logger.warn(`Seat reservation rejected for unknown booking ${bookingId}: ${reason}`);
      return;
    }

    if (sagaState.status === SagaStatus.BOOKING_CONFIRMED) {
      // Optimistic reservation: the booking was paid and confirmed before flight answered. It is cancelled below,
      // but the captured payment is not refunded automatically.
      this.logger.error(`Booking ${bookingId} was confirmed but flight rejected its seats; refund required: ${reason}`);
    }

    await this.compensate(sagaState, new Error(`Seat reservation rejected: ${reason}`), { flightSeatsReserved: false });
  }

  /**
   * Compensation (Idempotent). Throws if it fails, so callers do not report a cancellation that did not happen.
   */
  private async compensate(
    sagaState: SagaState,
    error: Error,
    options: { flightSeatsReserved?: boolean } = {},
  ): Promise<void> {
    const span = this.tracer.startSpan('saga.compensate');

    try {
      this.logger.warn(`Starting compensation for saga ${sagaState.sagaId}`);

      if (sagaState.status === SagaStatus.COMPENSATED) {
        this.logger.log('Saga already compensated (idempotent)');
        return;
      }

      await this.dataSource.transaction(async (manager) => {
        sagaState.status = SagaStatus.COMPENSATING;
        sagaState.errorMessage = error.message;
        await manager.save(SagaState, sagaState);

        // Compensate based on current step
        if (options.flightSeatsReserved ?? sagaState.currentStep >= 3) {
          const dto = sagaState.payload as CreateBookingDto;

          const payload = {
            bookingId: sagaState.bookingId,
            flightId: Number(dto.flightId), // Coerce to number
            seatClass: dto.seatClass || 'ECONOMY', // Provide default
            seatCount: dto.seats || (dto.seatNumbers ? dto.seatNumbers.length : 1), // Provide default
          };

          // Release flight seats via outbox
          await this.outboxService.storeEvent(
            'BOOKING',
            sagaState.bookingId,
            EventPatterns.FLIGHT_RELEASE_SEATS,
            payload,
            manager,
          );
        }

        if (sagaState.currentStep >= 2) {
          // Release Redis locks (outside transaction)
          const dto = sagaState.payload as CreateBookingDto;
          await this.seatLockService.releaseSeats(Number(dto.flightId), sagaState.bookingId);
        }

        // Update booking to cancelled
        await manager.update(
          Booking,
          { bookingReference: sagaState.bookingId },
          {
            status: BookingStatus.CANCELLED,
            cancellationReason: `Saga failed: ${error.message}`,
            cancelledAt: new Date(),
          },
        );

        // Notify the customer (same transaction; compensation exits early once COMPENSATED, so this fires once)
        await this.outboxService.storeEvent(
          'BOOKING',
          sagaState.bookingId,
          EventPatterns.BOOKING_CANCELLED,
          {
            bookingId: sagaState.bookingId,
            userId: (sagaState.payload as CreateBookingDto).userId,
            reason: error.message,
          },
          manager,
        );

        // Mark saga as compensated
        sagaState.status = SagaStatus.COMPENSATED;
        await manager.save(SagaState, sagaState);
      });

      span.setStatus({ code: SpanStatusCode.OK });
      this.logger.log(`Compensation completed for saga ${sagaState.sagaId}`);
    } catch (compensationError) {
      this.logger.error('Compensation failed:', compensationError);
      span.setStatus({ code: SpanStatusCode.ERROR, message: compensationError.message });
      throw compensationError;
    } finally {
      span.end();
    }
  }
}
