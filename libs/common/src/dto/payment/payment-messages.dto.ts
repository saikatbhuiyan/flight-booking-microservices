import { Type } from 'class-transformer';
import { IsDefined, IsInt, IsOptional, IsPositive, IsString, IsUUID, ValidateNested } from 'class-validator';
import { ConfirmPaymentIntentDto } from './confirm-payment-intent.dto';
import { CreateRefundDto } from './create-refund.dto';

export class PaymentIdMessageDto {
  @IsUUID()
  id: string;
}

export class ConfirmPaymentIntentMessageDto extends PaymentIdMessageDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ConfirmPaymentIntentDto)
  dto?: ConfirmPaymentIntentDto;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

/** payment.get_intent_by_booking and payment.get_refunds. */
export class BookingPaymentMessageDto {
  @IsInt()
  @IsPositive()
  bookingId: number;
}

export class CreateRefundMessageDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => CreateRefundDto)
  dto: CreateRefundDto;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
