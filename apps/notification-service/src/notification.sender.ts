import { Injectable, Logger } from '@nestjs/common';

export const NOTIFICATION_SENDER = Symbol('NOTIFICATION_SENDER');

export interface Notification {
  userId: number;
  subject: string;
  body: string;
}

/** Delivery channel (email, SMS, push). Implementations throw on failure so the event is dead-lettered. */
export interface NotificationSender {
  send(notification: Notification): Promise<void>;
}

/**
 * Logs notifications instead of delivering them. Replace with a provider-backed sender (e.g. SES) that resolves the
 * recipient's address from auth-service.
 */
@Injectable()
export class LogNotificationSender implements NotificationSender {
  private readonly logger = new Logger(LogNotificationSender.name);

  send(notification: Notification): Promise<void> {
    this.logger.log(`[notify user ${notification.userId}] ${notification.subject} — ${notification.body}`);
    return Promise.resolve();
  }
}
