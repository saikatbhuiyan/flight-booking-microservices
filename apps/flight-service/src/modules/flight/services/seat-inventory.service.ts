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

export interface SeatReservation {
  /** Fare per seat for the class (decimal currency units). */
  unitPrice: number;
  totalPrice: number;
}

interface SeatClassFields {
  seats:
    | 'economySeatsAvailable'
    | 'businessSeatsAvailable'
    | 'firstClassSeatsAvailable'
    | 'premiumEconomySeatsAvailable';
  price: 'economyPrice' | 'businessPrice' | 'firstClassPrice' | 'premiumEconomyPrice';
}

const SEAT_CLASSES: Record<string, SeatClassFields> = {
  ECONOMY: { seats: 'economySeatsAvailable', price: 'economyPrice' },
  BUSINESS: { seats: 'businessSeatsAvailable', price: 'businessPrice' },
  FIRST_CLASS: { seats: 'firstClassSeatsAvailable', price: 'firstClassPrice' },
  PREMIUM_ECONOMY: { seats: 'premiumEconomySeatsAvailable', price: 'premiumEconomyPrice' },
};

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

  /**
   * Reserves seats and returns the fare, or throws SeatReservationRejectedError. A retry with the same eventId gets
   * the same answer without taking seats again (the fare is re-read for it).
   */
  async reserve(cmd: SeatCommand): Promise<SeatReservation> {
    const outcome = await this.dataSource.transaction(async (manager): Promise<SeatReservation | string> => {
      const previous = await manager.findOne(ProcessedEvent, { where: { eventId: cmd.eventId } });
      const flight = await manager.findOne(Flight, {
        where: { id: cmd.flightId },
        lock: { mode: 'pessimistic_write' },
      });
      const fields = SEAT_CLASSES[cmd.seatClass];

      if (previous) {
        const wasReserved = previous.eventType === (EventPatterns.FLIGHT_RESERVE_SEATS as string);
        return wasReserved && flight && fields
          ? this.fare(flight, fields, cmd.seatCount)
          : `Reservation ${cmd.eventId} was already rejected`;
      }

      if (!flight) {
        return `Flight ${cmd.flightId} not found`;
      }

      // A release processed first means the booking was cancelled before this reservation arrived.
      if (await this.hasProcessed(manager, cmd.bookingId, EventPatterns.FLIGHT_RELEASE_SEATS)) {
        return `Booking ${cmd.bookingId} was already released`;
      }

      if (!fields) {
        return `Unknown seat class ${cmd.seatClass}`;
      }

      if (flight[fields.seats] < cmd.seatCount) {
        return `Not enough seats. Requested: ${cmd.seatCount}, Available: ${flight[fields.seats]}`;
      }

      await manager.decrement(Flight, { id: cmd.flightId }, fields.seats, cmd.seatCount);
      await manager.save(ProcessedEvent, {
        eventId: cmd.eventId,
        eventType: EventPatterns.FLIGHT_RESERVE_SEATS,
        aggregateId: cmd.bookingId,
      });
      this.logger.log(`Reserved ${cmd.seatCount} ${cmd.seatClass} seats for booking ${cmd.bookingId}`);
      return this.fare(flight, fields, cmd.seatCount);
    });

    if (typeof outcome !== 'string') {
      return outcome;
    }

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
    throw new SeatReservationRejectedError(outcome);
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
      const fields = SEAT_CLASSES[cmd.seatClass];

      if (reserved && !alreadyReleased && fields) {
        await manager.increment(Flight, { id: cmd.flightId }, fields.seats, cmd.seatCount);
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

  /** Decimal columns come back from pg as strings; the total is computed in cents to avoid float drift. */
  private fare(flight: Flight, fields: SeatClassFields, seatCount: number): SeatReservation {
    const unitCents = Math.round(Number(flight[fields.price]) * 100);
    return { unitPrice: unitCents / 100, totalPrice: (unitCents * seatCount) / 100 };
  }
}
