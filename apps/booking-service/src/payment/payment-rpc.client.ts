import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { PaymentClient, CreatePaymentIntentRequest, CreatePaymentIntentResponse } from './payment-client.interface';
import { BookingPaymentMode } from './payment-mode';
import { MessagePatterns } from '@app/common';

export const PAYMENT_RMQ_CLIENT = Symbol('PAYMENT_RMQ_CLIENT');

@Injectable()
export class PaymentRpcClient implements PaymentClient {
  private readonly logger = new Logger(PaymentRpcClient.name);

  constructor(@Inject(PAYMENT_RMQ_CLIENT) private readonly client: ClientProxy) {}

  async createPaymentIntent(req: CreatePaymentIntentRequest): Promise<CreatePaymentIntentResponse> {
    const payload = {
      dto: {
        bookingId: req.bookingId,
        bookingReference: req.bookingReference,
        userId: req.userId,
        amount: req.amountCents,
        currency: req.currency,
        paymentMethod: req.paymentMethod,
        metadata: {
          bookingReference: req.bookingReference,
          ...(req.metadata || {}),
        },
      },
      idempotencyKey: req.idempotencyKey,
    };

    try {
      const res = await firstValueFrom(
        this.client.send(MessagePatterns.PAYMENT_CREATE_INTENT, payload).pipe(timeout(5000)),
      );

      return {
        paymentId: res?.id,
        clientSecret: res?.clientSecret ?? null,
        status: res?.status,
        paymentRequired: true,
        provider: BookingPaymentMode.PAYMENT_SERVICE,
      };
    } catch (err) {
      this.logger.warn(`Failed to create payment intent via RPC: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}
