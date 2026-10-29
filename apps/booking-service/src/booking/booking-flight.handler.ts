import { Injectable } from '@nestjs/common';
import { BookingSagaOrchestrator } from '../booking-saga/saga-orchestrator.service';
import { SubscribeSeatReservationFailed } from '../config/rabbitmq.config';

type SeatReservationFailedEvent = {
  bookingId: string;
  flightId: number;
  reason: string;
};

@Injectable()
export class BookingFlightHandler {
  constructor(private readonly sagaOrchestrator: BookingSagaOrchestrator) {}

  @SubscribeSeatReservationFailed()
  handleSeatReservationFailed(event: SeatReservationFailedEvent): Promise<void> {
    return this.sagaOrchestrator.handleSeatReservationRejected(event.bookingId, event.reason);
  }
}
