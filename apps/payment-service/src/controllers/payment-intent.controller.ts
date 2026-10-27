import { Controller, Logger, UseFilters, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PaymentService } from '../services/payment.service';
import { CreatePaymentIntentDto } from '../dto/create-payment-intent.dto';
import {
  CommonRpcExceptionFilter,
  RpcValidationPipe,
  ConfirmPaymentIntentDto,
  MessagePatterns,
  QueryLedgerEntriesDto,
} from '@app/common';

type CreatePaymentIntentMessage =
  | CreatePaymentIntentDto
  | {
      dto: CreatePaymentIntentDto;
      idempotencyKey?: string;
    };

/**
 * RabbitMQ handlers for payment intents. booking-service creates intents; clients reach the rest through the
 * API gateway, which enforces ownership. Only the provider webhooks are served over HTTP.
 */
@Controller()
@UseFilters(CommonRpcExceptionFilter)
@UsePipes(RpcValidationPipe)
export class PaymentIntentController {
  private readonly logger = new Logger(PaymentIntentController.name);

  constructor(private readonly paymentService: PaymentService) {}

  @MessagePattern(MessagePatterns.PAYMENT_CREATE_INTENT)
  async handleCreateIntent(@Payload() payload: CreatePaymentIntentMessage) {
    const dto = 'dto' in payload ? payload.dto : payload;
    const idempotencyKey = 'dto' in payload ? payload.idempotencyKey : undefined;

    this.logger.log(`[RabbitMQ] Creating payment intent for booking ${dto.bookingId}`);
    return this.paymentService.createPaymentIntent(dto, idempotencyKey);
  }

  @MessagePattern(MessagePatterns.PAYMENT_GET_INTENT)
  async handleGetIntent(@Payload() data: { id: string }) {
    this.logger.log(`[RabbitMQ] Getting payment intent ${data.id}`);
    return this.paymentService.getPaymentIntent(data.id);
  }

  @MessagePattern(MessagePatterns.PAYMENT_GET_INTENT_BY_BOOKING)
  async handleGetIntentByBooking(@Payload() data: { bookingId: number }) {
    return this.paymentService.getPaymentIntentByBooking(data.bookingId);
  }

  @MessagePattern(MessagePatterns.PAYMENT_CONFIRM_INTENT)
  async handleConfirmIntent(@Payload() data: { id: string; dto?: ConfirmPaymentIntentDto; idempotencyKey?: string }) {
    this.logger.log(`[RabbitMQ] Confirming payment intent ${data.id}`);
    return this.paymentService.confirmPaymentIntent(data.id, data.dto || {}, data.idempotencyKey);
  }

  @MessagePattern(MessagePatterns.PAYMENT_GET_LEDGER_ENTRIES)
  async handleGetLedgerEntries(@Payload() query: QueryLedgerEntriesDto) {
    return this.paymentService.getLedgerEntries(query);
  }
}
