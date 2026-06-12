import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { EventPatterns } from '@app/common';
import { BookingService } from './booking.service';

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

  @RabbitSubscribe({
    exchange: 'payment.events',
    routingKey: EventPatterns.PAYMENT_COMPLETED,
    queue: 'booking-service.payment-completed',
  })
  async handlePaymentCompleted(msg: PaymentCompletedEvent): Promise<void> {
    const bookingReference = msg.bookingReference?.trim();

    if (!bookingReference) {
      this.logger.warn(`Skipping payment completion event ${msg.paymentId}: missing booking reference`);
      return;
    }

    const paymentTransactionId = msg.gatewayTransactionId || msg.gatewayPaymentId || msg.paymentId;

    this.logger.log(`Completing booking ${bookingReference} from payment ${msg.paymentId}`);
    await this.bookingService.completeBookingFromPaymentEvent(bookingReference, paymentTransactionId);
  }
}
