import { Type } from 'class-transformer';
import { IsDefined, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CreatePaymentIntentDto } from './create-payment-intent.dto';

/** payment.create_intent, sent by booking-service. */
export class CreatePaymentIntentMessageDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => CreatePaymentIntentDto)
  dto: CreatePaymentIntentDto;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
