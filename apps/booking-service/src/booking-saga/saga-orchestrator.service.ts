import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Booking, BookingStatus, PaymentStatus } from '../entities/booking.entity';
import { SagaState, SagaStatus } from '../entities/saga-state.entity';
import { SeatLockService } from '@app/seat-lock';
import { OutboxService } from '../outbox/outbox.service';
import { v4 as uuidv4 } from 'uuid';
import { trace, context as otelContext, SpanStatusCode } from '@opentelemetry/api';
import { EventPatterns } from '@app/common';

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
   * Step 3: Reserve Flight Seats (Idempotent via Outbox)
   */
  private async executeStep3_ReserveFlightSeats(sagaState: SagaState): Promise<void> {
    const span = this.tracer.startSpan('saga.step3.reserveFlightSeats');

    try {
      if (sagaState.currentStep >= 3) {
        this.logger.log('Step 3 already completed (idempotent)');
        span.end();
        return;
      }

      await this.dataSource.transaction(async (manager) => {
        const dto = sagaState.payload as CreateBookingDto;

        // Store event in outbox
        await this.outboxService.storeEvent(
          'BOOKING',
          sagaState.bookingId,
          EventPatterns.FLIGHT_RESERVE_SEATS,
          {
            flightId: Number(dto.flightId), // Coerce to number
            bookingId: sagaState.bookingId,
            seatClass: dto.seatClass || 'ECONOMY', // Provide default
            seatCount: dto.seats || (dto.seatNumbers ? dto.seatNumbers.length : 1), // Provide default
          },
          manager,
        );

        // Update saga state
        sagaState.currentStep = 3;
        sagaState.status = SagaStatus.FLIGHT_RESERVED;
        await manager.save(SagaState, sagaState);

        // Update booking status
        await manager.update(Booking, { bookingReference: sagaState.bookingId }, { status: BookingStatus.PENDING });
      });

      this.logger.log('Step 3 completed: Flight reservation requested');
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
   * Compensation (Idempotent)
   */
  private async compensate(sagaState: SagaState, error: Error): Promise<void> {
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
        if (sagaState.currentStep >= 3) {
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

        // Mark saga as compensated
        sagaState.status = SagaStatus.COMPENSATED;
        await manager.save(SagaState, sagaState);
      });

      span.setStatus({ code: SpanStatusCode.OK });
      this.logger.log(`Compensation completed for saga ${sagaState.sagaId}`);
    } catch (compensationError) {
      this.logger.error('Compensation failed:', compensationError);
      span.setStatus({ code: SpanStatusCode.ERROR, message: compensationError.message });
    } finally {
      span.end();
    }
  }
}
