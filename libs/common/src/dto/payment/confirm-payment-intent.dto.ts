import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ConfirmPaymentIntentDto {
  @ApiPropertyOptional({
    description: 'Gateway payment intent identifier. When omitted, the persisted value is used.',
    example: 'pi_3Qabc123xyz',
  })
  @IsOptional()
  @IsString()
  gatewayPaymentId?: string;
}
