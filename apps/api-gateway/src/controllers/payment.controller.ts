import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  MessagePatterns as MP,
  ApiResponseDto,
  ConfirmPaymentIntentDto,
  CreateRefundDto,
  CurrentUser,
  QueryLedgerEntriesDto,
  Role,
  Roles,
  createHttpExceptionFromRpcError,
} from '@app/common';
import { RateLimit } from '@app/rate-limiter';

interface PaymentOwner {
  userId: number;
}

interface RequestUser {
  id: number;
  role?: Role;
}

/**
 * API Gateway controller for payments. Payment intents are created by booking-service during the booking saga, so
 * there is no public create route. Users may read and confirm their own payments; refunds and the ledger are admin-only.
 */
@ApiTags('Payments')
@ApiBearerAuth('JWT-auth')
@Controller('payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(@Inject('PAYMENT_SERVICE') private readonly paymentClient: ClientProxy) {}

  @Get('ledger/entries')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Query ledger entries for reporting and reconciliation' })
  async getLedgerEntries(@Query() query: QueryLedgerEntriesDto) {
    const result = await this.callService(MP.PAYMENT_GET_LEDGER_ENTRIES, query);
    return ApiResponseDto.success(result, 'payment.intent.ledger.success');
  }

  @Post('refunds')
  @Roles(Role.ADMIN)
  @RateLimit({ points: 5, duration: 60 })
  @ApiOperation({ summary: 'Create a refund' })
  @ApiHeader({ name: 'idempotency-key', required: false })
  async createRefund(@Body() dto: CreateRefundDto, @Headers('idempotency-key') idempotencyKey?: string) {
    const result = await this.callService(MP.PAYMENT_CREATE_REFUND, { dto, idempotencyKey });
    return ApiResponseDto.success(result, 'refund.create.success');
  }

  @Get('booking/:bookingId')
  @ApiOperation({ summary: 'Get the payment for one of my bookings' })
  @ApiParam({ name: 'bookingId', description: 'Booking ID' })
  async getByBooking(@Param('bookingId', ParseIntPipe) bookingId: number, @CurrentUser() user: RequestUser) {
    const payment = await this.callService<PaymentOwner>(MP.PAYMENT_GET_INTENT_BY_BOOKING, { bookingId });
    this.assertCanAccess(payment, user);
    return ApiResponseDto.success(payment, 'payment.intent.get.success');
  }

  @Get('booking/:bookingId/refunds')
  @ApiOperation({ summary: 'List refunds for one of my bookings' })
  @ApiParam({ name: 'bookingId', description: 'Booking ID' })
  async getRefundsByBooking(@Param('bookingId', ParseIntPipe) bookingId: number, @CurrentUser() user: RequestUser) {
    const payment = await this.callService<PaymentOwner>(MP.PAYMENT_GET_INTENT_BY_BOOKING, { bookingId });
    this.assertCanAccess(payment, user);
    const result = await this.callService(MP.PAYMENT_GET_REFUNDS, { bookingId });
    return ApiResponseDto.success(result, 'refund.list.success');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of my payments' })
  @ApiParam({ name: 'id', description: 'Payment ID' })
  async getPayment(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    const payment = await this.callService<PaymentOwner>(MP.PAYMENT_GET_INTENT, { id });
    this.assertCanAccess(payment, user);
    return ApiResponseDto.success(payment, 'payment.intent.get.success');
  }

  @Post(':id/confirm')
  @RateLimit({ points: 5, duration: 60 })
  @ApiOperation({ summary: 'Confirm one of my payments' })
  @ApiParam({ name: 'id', description: 'Payment ID' })
  @ApiHeader({ name: 'idempotency-key', required: false })
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmPaymentIntentDto,
    @CurrentUser() user: RequestUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const payment = await this.callService<PaymentOwner>(MP.PAYMENT_GET_INTENT, { id });
    this.assertCanAccess(payment, user);
    const result = await this.callService(MP.PAYMENT_CONFIRM_INTENT, { id, dto, idempotencyKey });
    return ApiResponseDto.success(result, 'payment.intent.confirm.success');
  }

  /** Non-owners get 404 rather than 403 so payment and booking ids cannot be probed. */
  private assertCanAccess(payment: PaymentOwner, user: RequestUser): void {
    if (user.role === Role.ADMIN || Number(payment?.userId) === Number(user.id)) {
      return;
    }
    throw new NotFoundException({ code: 'resource.not_found', message: 'Payment not found' });
  }

  private async callService<TResult, TInput = unknown>(pattern: string, data: TInput): Promise<TResult> {
    try {
      return await firstValueFrom(this.paymentClient.send<TResult>(pattern, data));
    } catch (error) {
      this.logger.error(`Error calling ${pattern}`, JSON.stringify(error, null, 2));
      throw createHttpExceptionFromRpcError(error);
    }
  }
}
