import { Controller, Logger, UseFilters, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RefundService } from '../services/refund.service';
import {
  BookingPaymentMessageDto,
  CommonRpcExceptionFilter,
  CreateRefundMessageDto,
  MessagePatterns,
  RpcValidationPipe,
} from '@app/common';

/**
 * RabbitMQ handlers for refunds. Clients reach these through the API gateway only.
 */
@Controller()
@UseFilters(CommonRpcExceptionFilter)
@UsePipes(RpcValidationPipe)
export class RefundController {
  private readonly logger = new Logger(RefundController.name);

  constructor(private readonly refundService: RefundService) {}

  @MessagePattern(MessagePatterns.PAYMENT_CREATE_REFUND)
  async handleCreateRefund(@Payload() { dto, idempotencyKey }: CreateRefundMessageDto) {
    this.logger.log(`[RabbitMQ] Creating refund for payment ${dto.paymentId}`);
    return this.refundService.createRefund(dto, idempotencyKey);
  }

  @MessagePattern(MessagePatterns.PAYMENT_GET_REFUNDS)
  async handleGetRefunds(@Payload() data: BookingPaymentMessageDto) {
    this.logger.log(`[RabbitMQ] Getting refunds for booking ${data.bookingId}`);
    return this.refundService.getRefundsByBooking(data.bookingId);
  }
}
