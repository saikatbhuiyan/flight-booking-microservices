import { Controller, UseFilters, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CommonRpcExceptionFilter,
  RpcValidationPipe,
  MessagePatterns as MP,
  BookingRefMessageDto,
  CancelBookingMessageDto,
  CompleteBookingMessageDto,
  CreateBookingMessageDto,
  SeatAvailabilityMessageDto,
  UserBookingsMessageDto,
} from '@app/common';
import { BookingService } from './booking.service';

/**
 * RabbitMQ handlers for booking operations. Clients reach these through the API gateway only,
 * which authenticates the user and passes userId in the payload.
 */
@Controller()
@UseFilters(CommonRpcExceptionFilter)
@UsePipes(RpcValidationPipe)
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @MessagePattern(MP.BOOKING_CREATE)
  async handleCreateBooking(@Payload() data: CreateBookingMessageDto) {
    return this.bookingService.createBooking(data, data.userId);
  }

  @MessagePattern(MP.BOOKING_COMPLETE)
  async handleCompleteBooking(@Payload() data: CompleteBookingMessageDto) {
    return this.bookingService.completeBooking(data.bookingId, data.userId, data.paymentTransactionId);
  }

  @MessagePattern(MP.BOOKING_CANCEL)
  async handleCancelBooking(@Payload() data: CancelBookingMessageDto) {
    return this.bookingService.cancelBooking(data.bookingId, data.userId, data.reason);
  }

  @MessagePattern(MP.BOOKING_EXTEND)
  async handleExtendBooking(@Payload() data: BookingRefMessageDto) {
    return this.bookingService.extendBooking(data.bookingId, data.userId);
  }

  @MessagePattern(MP.BOOKING_FIND_BY_USER)
  async handleGetMyBookings(@Payload() data: UserBookingsMessageDto) {
    return this.bookingService.getMyBookings(data.userId, data.status);
  }

  @MessagePattern(MP.BOOKING_FIND_BY_ID)
  async handleGetBooking(@Payload() data: BookingRefMessageDto) {
    return this.bookingService.getBooking(data.bookingId, data.userId);
  }

  @MessagePattern(MP.BOOKING_CHECK_AVAILABILITY)
  async handleCheckAvailability(@Payload() data: SeatAvailabilityMessageDto) {
    return this.bookingService.checkSeatAvailability(data.flightId, data.seats);
  }
}
