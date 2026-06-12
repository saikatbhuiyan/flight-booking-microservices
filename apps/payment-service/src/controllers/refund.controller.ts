import { Controller, Post, Get, Body, Query, Logger, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RefundService } from '../services/refund.service';
import { CreateRefundDto } from '../dto/create-refund.dto';
import { MessagePatterns, successResponse } from '@app/common';

@ApiTags('Refunds')
@Controller('refunds')
export class RefundController {
  private readonly logger = new Logger(RefundController.name);

  constructor(private readonly refundService: RefundService) {}

  @Post()
  @ApiOperation({ summary: 'Create a refund' })
  @ApiResponse({ status: 201, description: 'Refund created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async createRefund(@Body() dto: CreateRefundDto, @Headers('idempotency-key') idempotencyKey?: string) {
    this.logger.log(`Creating refund for payment ${dto.paymentId}`);
    const result = await this.refundService.createRefund(dto, idempotencyKey);
    return successResponse('refund.create.success', result);
  }

  @Get()
  @ApiOperation({ summary: 'Get refunds by booking ID' })
  @ApiResponse({ status: 200, description: 'Refunds found' })
  async getRefundsByBooking(@Query('bookingId') bookingId: number) {
    const result = await this.refundService.getRefundsByBooking(bookingId);
    return successResponse('refund.list.success', result);
  }

  @MessagePattern(MessagePatterns.PAYMENT_CREATE_REFUND)
  async handleCreateRefund(@Payload() data: { dto: CreateRefundDto; idempotencyKey?: string } | CreateRefundDto) {
    const dto = 'dto' in data ? data.dto : data;
    const idempotencyKey = 'dto' in data ? data.idempotencyKey : undefined;
    this.logger.log(`[RabbitMQ] Creating refund for payment ${dto.paymentId}`);
    return this.refundService.createRefund(dto, idempotencyKey);
  }

  @MessagePattern(MessagePatterns.PAYMENT_GET_REFUNDS)
  async handleGetRefunds(@Payload() data: { bookingId: number }) {
    this.logger.log(`[RabbitMQ] Getting refunds for booking ${data.bookingId}`);
    return this.refundService.getRefundsByBooking(data.bookingId);
  }
}
