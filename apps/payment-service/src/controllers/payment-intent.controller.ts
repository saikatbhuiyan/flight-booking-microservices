import { Controller, Logger, UseFilters, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PaymentService } from '../services/payment.service';
import { CreatePaymentIntentMessageDto } from '../dto/create-payment-intent-message.dto';
import {
  CommonRpcExceptionFilter,
  RpcValidationPipe,
  BookingPaymentMessageDto,
  ConfirmPaymentIntentMessageDto,
  PaymentIdMessageDto,
  MessagePatterns,
  QueryLedgerEntriesDto,
} from '@app/common';

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
  async handleCreateIntent(@Payload() { dto, idempotencyKey }: CreatePaymentIntentMessageDto) {
    this.logger.log(`[RabbitMQ] Creating payment intent for booking ${dto.bookingId}`);
    return this.paymentService.createPaymentIntent(dto, idempotencyKey);
  }

  @MessagePattern(MessagePatterns.PAYMENT_GET_INTENT)
  async handleGetIntent(@Payload() data: PaymentIdMessageDto) {
    this.logger.log(`[RabbitMQ] Getting payment intent ${data.id}`);
    return this.paymentService.getPaymentIntent(data.id);
  }

  @MessagePattern(MessagePatterns.PAYMENT_GET_INTENT_BY_BOOKING)
  async handleGetIntentByBooking(@Payload() data: BookingPaymentMessageDto) {
    return this.paymentService.getPaymentIntentByBooking(data.bookingId);
  }

  @MessagePattern(MessagePatterns.PAYMENT_CONFIRM_INTENT)
  async handleConfirmIntent(@Payload() data: ConfirmPaymentIntentMessageDto) {
    this.logger.log(`[RabbitMQ] Confirming payment intent ${data.id}`);
    return this.paymentService.confirmPaymentIntent(data.id, data.dto || {}, data.idempotencyKey);
  }

  @MessagePattern(MessagePatterns.PAYMENT_GET_LEDGER_ENTRIES)
  async handleGetLedgerEntries(@Payload() query: QueryLedgerEntriesDto) {
    return this.paymentService.getLedgerEntries(query);
  }
}
