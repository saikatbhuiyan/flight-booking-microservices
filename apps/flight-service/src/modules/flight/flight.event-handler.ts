import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { trace, context as otelContext, SpanStatusCode } from '@opentelemetry/api';
import { ProcessedEvent } from '../../entities/processed-events.entity';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { EventPatterns } from '@app/common';
import { SubscribeSeatEvent } from '../../config/rabbitmq.config';
import { SeatInventoryService, SeatReservationRejectedError } from './services/seat-inventory.service';

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

@Injectable()
export class FlightEventHandler {
  private readonly logger = new Logger(FlightEventHandler.name);
  private readonly tracer = trace.getTracer('flight-service');

  constructor(
    @InjectRepository(ProcessedEvent)
    private readonly processedEventRepository: Repository<ProcessedEvent>,

    private readonly dataSource: DataSource,

    private readonly amqpConnection: AmqpConnection,

    private readonly seatInventory: SeatInventoryService,
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
      await otelContext.with(trace.setSpan(otelContext.active(), span), () =>
        this.seatInventory.reserve({ ...msg, eventId }),
      );
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.logger.error(`Error reserving seats for event ${eventId}: ${errorMessage}`);
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });

      // Legacy event path: booking-service now reserves over RPC, but queued events still need an answer.
      if (error instanceof SeatReservationRejectedError) {
        await this.publishRejection(msg, eventId, errorMessage);
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
      await this.seatInventory.release({ ...msg, eventId });
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

  /** Tells the booking saga the reservation can never succeed (seat inventory has already recorded the rejection). */
  private async publishRejection(msg: FlightSeatEvent, eventId: string, reason: string): Promise<void> {
    await this.amqpConnection.publish('flight.events', EventPatterns.FLIGHT_SEATS_RESERVATION_FAILED, {
      bookingId: msg.bookingId,
      flightId: msg.flightId,
      seatClass: msg.seatClass,
      seatCount: msg.seatCount,
      reason,
      _metadata: { eventId: `${eventId}:rejected` },
    });
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
