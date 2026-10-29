import { Injectable, BadRequestException, HttpException, NotFoundException, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SeatLockService } from '@app/seat-lock';
import { BookingSagaOrchestrator, CreateBookingDto } from '../booking-saga/saga-orchestrator.service';
import { BookingRepository } from '../repositories/booking.repository';
import { PAYMENT_CLIENT } from '../payment/payment.providers';
import { CreatePaymentIntentResponse, PaymentClient } from '../payment/payment-client.interface';
import { Booking } from '../entities/booking.entity';

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly sagaOrchestrator: BookingSagaOrchestrator,
    private readonly bookingRepository: BookingRepository,
    private readonly seatLockService: SeatLockService,
    @Inject(PAYMENT_CLIENT) private readonly paymentClient: PaymentClient,
  ) {}

  async createBooking(dto: CreateBookingDto, userId: number) {
    try {
      const booking = await this.sagaOrchestrator.executeBookingSaga({
        ...dto,
        userId,
      });

      const { finalBooking, paymentIntent } = await this.prepareBookingForPayment(booking, userId);

      return {
        bookingId: finalBooking.bookingReference,
        status: finalBooking.status,
        expiresAt: finalBooking.expiresAt,
        totalCost: finalBooking.totalCost,
        paymentRequired: paymentIntent.paymentRequired,
        autoCompleted: !paymentIntent.paymentRequired,
        payment: {
          paymentId: paymentIntent.paymentId,
          clientSecret: paymentIntent.clientSecret,
          provider: paymentIntent.provider,
          status: paymentIntent.status,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`createBooking failed: ${message}`);
      // Keep meaningful statuses (409 seats unavailable, 503 flight unreachable) instead of flattening to 400.
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException(message);
    }
  }

  async completeBooking(bookingId: string, userId: number, paymentTransactionId: string) {
    try {
      const booking = await this.bookingRepository.findByReference(bookingId);
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }

      if (booking.userId !== userId) {
        throw new BadRequestException('Unauthorized');
      }

      return this.completeBookingFromPaymentEvent(bookingId, paymentTransactionId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async completeBookingFromPaymentEvent(bookingId: string, paymentTransactionId: string) {
    if (!paymentTransactionId) {
      throw new BadRequestException('Payment transaction ID is required');
    }

    const booking = await this.bookingRepository.findByReference(bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    const completedBooking = await this.sagaOrchestrator.completeBooking(bookingId, paymentTransactionId);

    return {
      bookingId: completedBooking.bookingReference,
      status: completedBooking.status,
      paymentStatus: completedBooking.paymentStatus,
      seatNumbers: completedBooking.seatNumbers,
      flightNumber: completedBooking.flightNumber,
    };
  }

  async cancelBooking(bookingId: string, userId: number, reason?: string) {
    try {
      const booking = await this.bookingRepository.findByReference(bookingId);
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }

      if (booking.userId !== userId) {
        throw new BadRequestException('Unauthorized');
      }

      const cancelledBooking = await this.sagaOrchestrator.cancelBooking(
        bookingId,
        reason || 'User requested cancellation',
      );

      return {
        bookingId: cancelledBooking.bookingReference,
        status: cancelledBooking.status,
        refundAmount: cancelledBooking.refundAmount,
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async extendBooking(bookingId: string, userId: number) {
    try {
      const booking = await this.bookingRepository.findByReference(bookingId);
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }

      if (booking.userId !== userId) {
        throw new BadRequestException('Unauthorized');
      }

      const extended = await this.seatLockService.extendLock(booking.flightId, bookingId, 300); // 5 more minutes

      if (!extended) {
        throw new BadRequestException('Cannot extend booking - locks may have expired');
      }

      // Update booking expiry in DB
      booking.expiresAt = new Date(Date.now() + 300 * 1000);
      await this.bookingRepository.update(booking.id, {
        expiresAt: booking.expiresAt,
      });

      return {
        bookingId,
        expiresAt: booking.expiresAt,
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async getMyBookings(userId: number, status?: string) {
    const bookings = await this.bookingRepository.findByUserId(userId);
    return bookings.filter((b) => !status || (b.status as string) === status);
  }

  async getBooking(bookingId: string, userId: number) {
    const booking = await this.bookingRepository.findByReference(bookingId);

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.userId !== userId) {
      throw new BadRequestException('Unauthorized');
    }

    return booking;
  }

  async checkSeatAvailability(flightId: number, seats: string) {
    const seatArray = seats.split(',');
    const lockedSeats = await this.seatLockService.areSeatsLocked(flightId, seatArray);

    const availability = Array.from(lockedSeats.entries()).map(([seat, locked]) => ({
      seat,
      available: !locked,
    }));

    return {
      flightId,
      seats: availability,
      allAvailable: availability.every((s) => s.available),
    };
  }

  private createPaymentIntentForBooking(booking: Booking, userId: number): Promise<CreatePaymentIntentResponse> {
    return this.paymentClient.createPaymentIntent({
      bookingId: booking.id,
      bookingReference: booking.bookingReference,
      userId,
      amountCents: Math.round(Number(booking.totalCost || 0) * 100),
      currency: 'USD',
      paymentMethod: 'card',
      idempotencyKey: `booking:${booking.bookingReference}`,
    });
  }

  private async prepareBookingForPayment(
    booking: Booking,
    userId: number,
  ): Promise<{ finalBooking: Booking; paymentIntent: CreatePaymentIntentResponse }> {
    try {
      const paymentIntent = await this.createPaymentIntentForBooking(booking, userId);

      if (paymentIntent.paymentRequired) {
        return { finalBooking: booking, paymentIntent };
      }

      const txId = paymentIntent.paymentId || `local_mock_tx_${randomUUID()}`;
      const finalBooking = await this.sagaOrchestrator.completeBooking(booking.bookingReference, txId);

      return { finalBooking, paymentIntent };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.rollbackBookingAfterPaymentFailure(booking.bookingReference, message);
      throw error;
    }
  }

  private async rollbackBookingAfterPaymentFailure(bookingReference: string, reason: string): Promise<void> {
    try {
      await this.sagaOrchestrator.cancelBooking(bookingReference, `Payment initiation failed: ${reason}`);
    } catch (rollbackError) {
      this.logger.error(
        `Failed to roll back booking ${bookingReference} after payment failure: ${
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        }`,
      );
    }
  }
}
