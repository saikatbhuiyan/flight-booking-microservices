import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { trace, context as otelContext, SpanStatusCode } from '@opentelemetry/api';
import { ProcessedEvent } from '../../entities/processed-events.entity';
import { Flight } from '../../entities/flight.entity';

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
  ) {}

  @RabbitSubscribe({
    exchange: 'booking.events',
    routingKey: 'flight.reserve-seats',
    queue: 'flight-service.reserve-seats',
  })
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
            throw new Error(`Flight ${msg.flightId} not found`);
          }

          const seatField = this.getSeatField(msg.seatClass);
          const currentAvailable = flight[seatField];

          if (currentAvailable < msg.seatCount) {
            throw new Error(`Not enough seats. Requested: ${msg.seatCount}, Available: ${currentAvailable}`);
          }

          await manager.decrement(Flight, { id: msg.flightId }, seatField, msg.seatCount);

          await manager.save(ProcessedEvent, {
            eventId,
            eventType: 'flight.reserve-seats',
            aggregateId: msg.bookingId,
          });

          this.logger.log(`Reserved ${msg.seatCount} ${msg.seatClass} seats for booking ${msg.bookingId}`);
        });
      });

      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      this.logger.error(`Error reserving seats for event ${eventId}:`, error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });

      throw error;
    } finally {
      span.end();
    }
  }

  @RabbitSubscribe({
    exchange: 'booking.events',
    routingKey: 'flight.confirm-seats',
    queue: 'flight-service.confirm-seats',
  })
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
          eventType: 'flight.confirm-seats',
          aggregateId: msg.bookingId,
        });

        this.logger.log(`Confirmed seats for booking ${msg.bookingId}`);
      });

      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      this.logger.error(`Error confirming seats for event ${eventId}:`, error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  }

  @RabbitSubscribe({
    exchange: 'booking.events',
    routingKey: 'flight.release-seats',
    queue: 'flight-service.release-seats',
  })
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
        const seatField = this.getSeatField(msg.seatClass);

        await manager.increment(Flight, { id: msg.flightId }, seatField, msg.seatCount);

        await manager.save(ProcessedEvent, {
          eventId,
          eventType: 'flight.release-seats',
          aggregateId: msg.bookingId,
        });

        this.logger.log(`Released ${msg.seatCount} ${msg.seatClass} seats for booking ${msg.bookingId}`);
      });

      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      this.logger.error(`Error releasing seats for event ${eventId}:`, error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  }

  private getSeatField(seatClass: string): FlightSeatField {
    const mapping: Record<string, FlightSeatField> = {
      ECONOMY: 'economySeatsAvailable',
      BUSINESS: 'businessSeatsAvailable',
      FIRST_CLASS: 'firstClassSeatsAvailable',
      PREMIUM_ECONOMY: 'premiumEconomySeatsAvailable',
    };
    return mapping[seatClass];
  }
}
