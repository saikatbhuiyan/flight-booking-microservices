import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { BookingService } from './booking.service';
import { SubscribePaymentCompleted } from '../config/rabbitmq.config';

type PaymentCompletedEvent = {
  paymentId: string;
  bookingId: number;
  bookingReference?: string;
  userId: number;
  amount: number;
  currency: string;
  gateway: string;
  gatewayPaymentId: string;
  gatewayTransactionId?: string;
  status: string;
  confirmedAt?: string | null;
};

@Injectable()
export class BookingPaymentHandler {
  private readonly logger = new Logger(BookingPaymentHandler.name);

  constructor(private readonly bookingService: BookingService) {}

  @SubscribePaymentCompleted()
  async handlePaymentCompleted(msg: PaymentCompletedEvent): Promise<void> {
    const bookingReference = msg.bookingReference?.trim();

    if (!bookingReference) {
      this.logger.warn(`Skipping payment completion event ${msg.paymentId}: missing booking reference`);
      return;
    }

    const paymentTransactionId = msg.gatewayTransactionId || msg.gatewayPaymentId || msg.paymentId;

    this.logger.log(`Completing booking ${bookingReference} from payment ${msg.paymentId}`);
    try {
      await this.bookingService.completeBookingFromPaymentEvent(bookingReference, paymentTransactionId);
    } catch (error) {
      // A business outcome, not a transient failure: ack it instead of dead-lettering.
      if (error instanceof ConflictException) {
        this.logger.error(
          `Payment ${msg.paymentId} captured for cancelled booking ${bookingReference}; refund required`,
        );
        return;
      }
      throw error;
    }
  }
}
