import { Inject, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@app/common';
import { Notification, NOTIFICATION_SENDER, NotificationSender } from './notification.sender';

/** Events are delivered at least once; a notification is sent at most once per key within this window. */
const DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;

interface EventMetadata {
  _metadata?: { eventId?: string };
}

export interface BookingConfirmedEvent extends EventMetadata {
  bookingId: string;
  userId: number;
}

export interface BookingCancelledEvent extends EventMetadata {
  bookingId: string;
  userId: number;
  reason?: string;
}

export interface PaymentFailedEvent {
  paymentId: string;
  bookingId: number;
  bookingReference?: string | null;
  userId: number;
  amount: number;
  currency: string;
  failureReason?: string | null;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly redisService: RedisService,
    @Inject(NOTIFICATION_SENDER) private readonly sender: NotificationSender,
  ) {}

  bookingConfirmed(event: BookingConfirmedEvent): Promise<void> {
    return this.notifyOnce(event._metadata?.eventId ?? `booking.confirmed:${event.bookingId}`, {
      userId: event.userId,
      subject: `Booking ${event.bookingId} confirmed`,
      body: `Your booking ${event.bookingId} is confirmed. Have a good flight!`,
    });
  }

  bookingCancelled(event: BookingCancelledEvent): Promise<void> {
    return this.notifyOnce(event._metadata?.eventId ?? `booking.cancelled:${event.bookingId}`, {
      userId: event.userId,
      subject: `Booking ${event.bookingId} cancelled`,
      body: `Your booking ${event.bookingId} was cancelled${event.reason ? `: ${event.reason}` : '.'}`,
    });
  }

  paymentFailed(event: PaymentFailedEvent): Promise<void> {
    const booking = event.bookingReference || String(event.bookingId);
    const amount = (event.amount / 100).toFixed(2);
    return this.notifyOnce(`payment.failed:${event.paymentId}`, {
      userId: event.userId,
      subject: `Payment for booking ${booking} failed`,
      body: `We could not charge ${amount} ${event.currency} for booking ${booking}${
        event.failureReason ? ` (${event.failureReason})` : ''
      }. Please try another payment method.`,
    });
  }

  private async notifyOnce(dedupeKey: string, notification: Notification): Promise<void> {
    if (!notification.userId) {
      this.logger.warn(`Skipping notification ${dedupeKey}: event has no userId`);
      return;
    }

    const key = `notification:sent:${dedupeKey}`;
    const redis = this.redisService.getClient();
    const claimed = await redis.set(key, '1', 'EX', DEDUPE_TTL_SECONDS, 'NX');
    if (claimed !== 'OK') {
      this.logger.debug(`Notification ${dedupeKey} already sent (duplicate delivery)`);
      return;
    }

    try {
      await this.sender.send(notification);
    } catch (error) {
      // Release the claim so a replay from the dead-letter queue can retry.
      await redis.del(key);
      throw error;
    }
  }
}
