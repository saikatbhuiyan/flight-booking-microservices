import { Injectable } from '@nestjs/common';
import { SubscribeNotificationEvent } from './config/rabbitmq.config';
import {
  BookingCancelledEvent,
  BookingConfirmedEvent,
  NotificationService,
  PaymentFailedEvent,
} from './notification-service.service';

@Injectable()
export class NotificationEventsHandler {
  constructor(private readonly notificationService: NotificationService) {}

  @SubscribeNotificationEvent('bookingConfirmed')
  handleBookingConfirmed(event: BookingConfirmedEvent): Promise<void> {
    return this.notificationService.bookingConfirmed(event);
  }

  @SubscribeNotificationEvent('bookingCancelled')
  handleBookingCancelled(event: BookingCancelledEvent): Promise<void> {
    return this.notificationService.bookingCancelled(event);
  }

  @SubscribeNotificationEvent('paymentFailed')
  handlePaymentFailed(event: PaymentFailedEvent): Promise<void> {
    return this.notificationService.paymentFailed(event);
  }
}
