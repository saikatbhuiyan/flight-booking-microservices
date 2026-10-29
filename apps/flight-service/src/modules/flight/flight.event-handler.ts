import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { trace, context as otelContext, SpanStatusCode } from '@opentelemetry/api';
import { ProcessedEvent } from '../../entities/processed-events.entity';
import { Flight } from '../../entities/flight.entity';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { EventPatterns } from '@app/common';
import { SubscribeSeatEvent } from '../../config/rabbitmq.config';

type FlightSeatEvent = {
  flightId: number;
  bookingId: string;
  seatClass: string;
  seatCount: number;
  _metadata?: {
    eventId?: string;
    traceId?: string;
  };
};

/** A reservation the flight cannot satisfy. Reported to the saga instead of being dead-lettered. */
class SeatReservationRejectedError extends Error {}

/** Recorded instead of a reservation when the booking's release was processed first (events arrived out of order). */
const RESERVE_SKIPPED_AFTER_RELEASE = `${EventPatterns.FLIGHT_RESERVE_SEATS}:skipped-after-release`;

type FlightSeatField =
  | 'economySeatsAvailable'
  | 'businessSeatsAvailable'
  | 'firstClassSeatsAvailable'
  | 'premiumEconomySeatsAvailable';

@Injectable()
export class FlightEventHandler {
  private readonly logger = new Logger(FlightEventHandler.name);
  private readonly tracer = trace.getTracer('flight-service');

  constructor(
    @InjectRepository(Flight)
    private readonly flightRepository: Repository<Flight>,

    @InjectRepository(ProcessedEvent)
    private readonly processedEventRepository: Repository<ProcessedEvent>,

    private readonly dataSource: DataSource,

    private readonly amqpConnection: AmqpConnection,
  ) {}

  @SubscribeSeatEvent('reserve')
  async handleReserveSeats(msg: FlightSeatEvent): Promise<void> {
    const eventId = msg._metadata?.eventId;
    const traceId = msg._metadata?.traceId;

    const span = this.tracer.startSpan('flight.handleReserveSeats', {
      attributes: {
        'event.id': eventId,
        'flight.id': msg.flightId,
        'booking.id': msg.bookingId,
        'trace.id': traceId,
      },
    });

    try {
      const alreadyProcessed = await this.processedEventRepository.findOne({
        where: { eventId },
      });

      if (alreadyProcessed) {
        this.logger.log(`Event ${eventId} already processed (idempotent)`);
        span.setAttribute('idempotent', true);
        span.end();
        return;
      }

      await otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
        await this.dataSource.transaction(async (manager) => {
          const flight = await manager.findOne(Flight, {
            where: { id: msg.flightId },
            lock: { mode: 'pessimistic_write' },
          });

          if (!flight) {
            throw new SeatReservationRejectedError(`Flight ${msg.flightId} not found`);
          }

          // The flight row lock serializes this with handleReleaseSeats, so this check is race-free.
          if (await this.hasProcessed(manager, msg.bookingId, EventPatterns.FLIGHT_RELEASE_SEATS)) {
            await manager.save(ProcessedEvent, {
              eventId,
              eventType: RESERVE_SKIPPED_AFTER_RELEASE,
              aggregateId: msg.bookingId,
            });
            this.logger.warn(`Booking ${msg.bookingId} was already released; not reserving seats`);
            return;
          }

          const seatField = this.getSeatField(msg.seatClass);
          if (!seatField) {
            throw new SeatReservationRejectedError(`Unknown seat class ${msg.seatClass}`);
          }

          const currentAvailable = flight[seatField];

          if (currentAvailable < msg.seatCount) {
            throw new SeatReservationRejectedError(
              `Not enough seats. Requested: ${msg.seatCount}, Available: ${currentAvailable}`,
            );
          }

          await manager.decrement(Flight, { id: msg.flightId }, seatField, msg.seatCount);

          await manager.save(ProcessedEvent, {
            eventId,
            eventType: EventPatterns.FLIGHT_RESERVE_SEATS,
            aggregateId: msg.bookingId,
          });

          this.logger.log(`Reserved ${msg.seatCount} ${msg.seatClass} seats for booking ${msg.bookingId}`);
        });
      });

      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.logger.error(`Error reserving seats for event ${eventId}: ${errorMessage}`);
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });

      if (error instanceof SeatReservationRejectedError) {
        await this.rejectReservation(msg, eventId, errorMessage);
        return;
      }

      throw error;
    } finally {
      span.end();
    }
  }

  @SubscribeSeatEvent('confirm')
  async handleConfirmSeats(msg: FlightSeatEvent): Promise<void> {
    const eventId = msg._metadata?.eventId;

    const span = this.tracer.startSpan('flight.handleConfirmSeats', {
      attributes: {
        'event.id': eventId,
        'booking.id': msg.bookingId,
      },
    });

    try {
      const alreadyProcessed = await this.processedEventRepository.findOne({
        where: { eventId },
      });

      if (alreadyProcessed) {
        this.logger.log(`Event ${eventId} already processed (idempotent)`);
        span.end();
        return;
      }

      await this.dataSource.transaction(async (manager) => {
        await manager.save(ProcessedEvent, {
          eventId,
          eventType: EventPatterns.FLIGHT_CONFIRM_SEATS,
          aggregateId: msg.bookingId,
        });

        this.logger.log(`Confirmed seats for booking ${msg.bookingId}`);
      });

      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.logger.error(`Error confirming seats for event ${eventId}: ${errorMessage}`);
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
      throw error;
    } finally {
      span.end();
    }
  }

  @SubscribeSeatEvent('release')
  async handleReleaseSeats(msg: FlightSeatEvent): Promise<void> {
    const eventId = msg._metadata?.eventId;

    const span = this.tracer.startSpan('flight.handleReleaseSeats', {
      attributes: {
        'event.id': eventId,
        'flight.id': msg.flightId,
        'booking.id': msg.bookingId,
      },
    });

    try {
      const alreadyProcessed = await this.processedEventRepository.findOne({
        where: { eventId },
      });

      if (alreadyProcessed) {
        this.logger.log(`Event ${eventId} already processed (idempotent)`);
        span.end();
        return;
      }

      await this.dataSource.transaction(async (manager) => {
        // Same lock as handleReserveSeats, so reserve/release for a booking are serialized.
        await manager.findOne(Flight, { where: { id: msg.flightId }, lock: { mode: 'pessimistic_write' } });

        // Only give back seats this booking actually took, and only once.
        const reserved = await this.hasProcessed(manager, msg.bookingId, EventPatterns.FLIGHT_RESERVE_SEATS);
        const alreadyReleased = await this.hasProcessed(manager, msg.bookingId, EventPatterns.FLIGHT_RELEASE_SEATS);
        const seatField = this.getSeatField(msg.seatClass);

        if (reserved && !alreadyReleased && seatField) {
          await manager.increment(Flight, { id: msg.flightId }, seatField, msg.seatCount);
          this.logger.log(`Released ${msg.seatCount} ${msg.seatClass} seats for booking ${msg.bookingId}`);
        } else {
          this.logger.warn(
            `Nothing to release for booking ${msg.bookingId} (reserved=${reserved}, released=${alreadyReleased})`,
          );
        }

        // Recorded even when nothing was released, so a late reservation for this booking is skipped.
        await manager.save(ProcessedEvent, {
          eventId,
          eventType: EventPatterns.FLIGHT_RELEASE_SEATS,
          aggregateId: msg.bookingId,
        });
      });

      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.logger.error(`Error releasing seats for event ${eventId}: ${errorMessage}`);
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Tells the booking saga the reservation can never succeed, then marks the event processed. Publishing first means
   * a crash in between causes a duplicate rejection, which booking's compensation absorbs idempotently.
   */
  private async rejectReservation(msg: FlightSeatEvent, eventId: string, reason: string): Promise<void> {
    await this.amqpConnection.publish('flight.events', EventPatterns.FLIGHT_SEATS_RESERVATION_FAILED, {
      bookingId: msg.bookingId,
      flightId: msg.flightId,
      seatClass: msg.seatClass,
      seatCount: msg.seatCount,
      reason,
      _metadata: { eventId: `${eventId}:rejected` },
    });

    await this.processedEventRepository.save({
      eventId,
      eventType: EventPatterns.FLIGHT_SEATS_RESERVATION_FAILED,
      aggregateId: msg.bookingId,
    });
  }

  private async hasProcessed(manager: EntityManager, bookingId: string, eventType: string): Promise<boolean> {
    return (await manager.count(ProcessedEvent, { where: { aggregateId: bookingId, eventType } })) > 0;
  }

  private getSeatField(seatClass: string): FlightSeatField | undefined {
    const mapping: Record<string, FlightSeatField> = {
      ECONOMY: 'economySeatsAvailable',
      BUSINESS: 'businessSeatsAvailable',
      FIRST_CLASS: 'firstClassSeatsAvailable',
      PREMIUM_ECONOMY: 'premiumEconomySeatsAvailable',
    };
    return mapping[seatClass];
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
