import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CommonRpcExceptionFilter, MessagePatterns as MP } from '@app/common';
import { BookingService } from './booking.service';
import { CreateBookingDto } from '../booking-saga/saga-orchestrator.service';

/**
 * RabbitMQ handlers for booking operations. Clients reach these through the API gateway only,
 * which authenticates the user and passes userId in the payload.
 */
@Controller()
@UseFilters(CommonRpcExceptionFilter)
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @MessagePattern(MP.BOOKING_CREATE)
  async handleCreateBooking(@Payload() data: CreateBookingDto & { userId: number }) {
    return this.bookingService.createBooking(data, data.userId);
  }

  @MessagePattern(MP.BOOKING_COMPLETE)
  async handleCompleteBooking(
    @Payload()
    data: {
      bookingId: string;
      userId: number;
      paymentTransactionId: string;
    },
  ) {
    return this.bookingService.completeBooking(data.bookingId, data.userId, data.paymentTransactionId);
  }

  @MessagePattern(MP.BOOKING_CANCEL)
  async handleCancelBooking(@Payload() data: { bookingId: string; userId: number; reason?: string }) {
    return this.bookingService.cancelBooking(data.bookingId, data.userId, data.reason);
  }

  @MessagePattern(MP.BOOKING_EXTEND)
  async handleExtendBooking(@Payload() data: { bookingId: string; userId: number }) {
    return this.bookingService.extendBooking(data.bookingId, data.userId);
  }

  @MessagePattern(MP.BOOKING_FIND_BY_USER)
  async handleGetMyBookings(@Payload() data: { userId: number; status?: string }) {
    return this.bookingService.getMyBookings(data.userId, data.status);
  }

  @MessagePattern(MP.BOOKING_FIND_BY_ID)
  async handleGetBooking(@Payload() data: { bookingId: string; userId: number }) {
    return this.bookingService.getBooking(data.bookingId, data.userId);
  }

  @MessagePattern(MP.BOOKING_CHECK_AVAILABILITY)
  async handleCheckAvailability(@Payload() data: { flightId: number; seats: string }) {
    return this.bookingService.checkSeatAvailability(data.flightId, data.seats);
  }
}
