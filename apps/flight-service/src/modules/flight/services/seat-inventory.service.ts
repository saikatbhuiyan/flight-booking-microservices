import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { EventPatterns } from '@app/common';
import { Flight } from '../../../entities/flight.entity';
import { ProcessedEvent } from '../../../entities/processed-events.entity';

/** A reservation the flight can never satisfy (unknown flight or seat class, not enough seats, booking released). */
export class SeatReservationRejectedError extends Error {}

export interface SeatCommand {
  /** Idempotency key: the outbox eventId, or the saga's reservation id for RPC calls. */
  eventId: string;
  bookingId: string;
  flightId: number;
  seatClass: string;
  seatCount: number;
}

type FlightSeatField =
  | 'economySeatsAvailable'
  | 'businessSeatsAvailable'
  | 'firstClassSeatsAvailable'
  | 'premiumEconomySeatsAvailable';

/**
 * Seat inventory changes for bookings, shared by the RPC reservation and the seat event consumers.
 *
 * Every command is recorded in processed_events keyed by eventId (idempotency) and aggregateId = bookingId, which lets
 * release give back only seats a booking actually took. Reserve and release lock the flight row, so their checks for
 * the same flight are serialized.
 */
@Injectable()
export class SeatInventoryService {
  private readonly logger = new Logger(SeatInventoryService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** Reserves seats, or throws SeatReservationRejectedError. A retry with the same eventId gets the same answer. */
  async reserve(cmd: SeatCommand): Promise<void> {
    const rejection = await this.dataSource.transaction(async (manager) => {
      const previous = await manager.findOne(ProcessedEvent, { where: { eventId: cmd.eventId } });
      if (previous) {
        return previous.eventType === (EventPatterns.FLIGHT_RESERVE_SEATS as string)
          ? null
          : `Reservation ${cmd.eventId} was already rejected`;
      }

      const flight = await manager.findOne(Flight, {
        where: { id: cmd.flightId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!flight) {
        return `Flight ${cmd.flightId} not found`;
      }

      // A release processed first means the booking was cancelled before this reservation arrived.
      if (await this.hasProcessed(manager, cmd.bookingId, EventPatterns.FLIGHT_RELEASE_SEATS)) {
        return `Booking ${cmd.bookingId} was already released`;
      }

      const seatField = this.getSeatField(cmd.seatClass);
      if (!seatField) {
        return `Unknown seat class ${cmd.seatClass}`;
      }

      if (flight[seatField] < cmd.seatCount) {
        return `Not enough seats. Requested: ${cmd.seatCount}, Available: ${flight[seatField]}`;
      }

      await manager.decrement(Flight, { id: cmd.flightId }, seatField, cmd.seatCount);
      await manager.save(ProcessedEvent, {
        eventId: cmd.eventId,
        eventType: EventPatterns.FLIGHT_RESERVE_SEATS,
        aggregateId: cmd.bookingId,
      });
      this.logger.log(`Reserved ${cmd.seatCount} ${cmd.seatClass} seats for booking ${cmd.bookingId}`);
      return null;
    });

    if (rejection) {
      // Recorded so a retry gets the same answer (no-op if this was already a recorded rejection).
      await this.dataSource
        .createQueryBuilder()
        .insert()
        .into(ProcessedEvent)
        .values({
          eventId: cmd.eventId,
          eventType: EventPatterns.FLIGHT_SEATS_RESERVATION_FAILED,
          aggregateId: cmd.bookingId,
        })
        .orIgnore()
        .execute();
      throw new SeatReservationRejectedError(rejection);
    }
  }

  /** Gives back seats only if this booking reserved them, at most once. Idempotent per eventId. */
  async release(cmd: SeatCommand): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      if (await manager.findOne(ProcessedEvent, { where: { eventId: cmd.eventId } })) {
        return;
      }

      await manager.findOne(Flight, { where: { id: cmd.flightId }, lock: { mode: 'pessimistic_write' } });

      const reserved = await this.hasProcessed(manager, cmd.bookingId, EventPatterns.FLIGHT_RESERVE_SEATS);
      const alreadyReleased = await this.hasProcessed(manager, cmd.bookingId, EventPatterns.FLIGHT_RELEASE_SEATS);
      const seatField = this.getSeatField(cmd.seatClass);

      if (reserved && !alreadyReleased && seatField) {
        await manager.increment(Flight, { id: cmd.flightId }, seatField, cmd.seatCount);
        this.logger.log(`Released ${cmd.seatCount} ${cmd.seatClass} seats for booking ${cmd.bookingId}`);
      } else {
        this.logger.warn(
          `Nothing to release for booking ${cmd.bookingId} (reserved=${reserved}, released=${alreadyReleased})`,
        );
      }

      // Recorded even when nothing was released, so a late reservation for this booking is rejected.
      await manager.save(ProcessedEvent, {
        eventId: cmd.eventId,
        eventType: EventPatterns.FLIGHT_RELEASE_SEATS,
        aggregateId: cmd.bookingId,
      });
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
}
