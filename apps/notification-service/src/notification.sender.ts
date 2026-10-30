import { Injectable, Logger } from '@nestjs/common';
import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';
import { RecipientDirectory } from './recipient.directory';

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

/** Logs notifications instead of delivering them (NOTIFICATION_PROVIDER=log, the default). */
@Injectable()
export class LogNotificationSender implements NotificationSender {
  private readonly logger = new Logger(LogNotificationSender.name);

  send(notification: Notification): Promise<void> {
    this.logger.log(`[notify user ${notification.userId}] ${notification.subject} — ${notification.body}`);
    return Promise.resolve();
  }
}

export interface SesSenderConfig {
  from: string;
  region: string;
  /** LocalStack in development; omit for AWS. */
  endpoint?: string;
}

/**
 * Emails through Amazon SES (NOTIFICATION_PROVIDER=ses). The address and the user's email opt-out come from
 * auth-service; a lookup or SES failure throws, so the event is dead-lettered and can be replayed.
 */
export class SesNotificationSender implements NotificationSender {
  private readonly logger = new Logger(SesNotificationSender.name);
  private readonly ses: SESClient;

  constructor(
    private readonly config: SesSenderConfig,
    private readonly recipients: RecipientDirectory,
  ) {
    this.ses = new SESClient({ region: config.region, ...(config.endpoint && { endpoint: config.endpoint }) });
  }

  async send(notification: Notification): Promise<void> {
    const contact = await this.recipients.getContact(notification.userId);
    if (!contact.emailEnabled) {
      this.logger.log(`User ${notification.userId} disabled email notifications; skipping "${notification.subject}"`);
      return;
    }

    await this.ses.send(
      new SendEmailCommand({
        Source: this.config.from,
        Destination: { ToAddresses: [contact.email] },
        Message: {
          Subject: { Data: notification.subject },
          Body: { Text: { Data: `Hi ${contact.firstName},\n\n${notification.body}` } },
        },
      }),
    );
  }
}
