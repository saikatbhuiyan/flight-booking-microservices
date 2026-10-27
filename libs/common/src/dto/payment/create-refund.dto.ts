import { IsInt, IsString, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRefundDto {
  @ApiProperty({
    description: 'Payment ID to refund',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  paymentId: string;

  @ApiProperty({
    description: 'Booking ID',
    example: 123,
  })
  @IsInt()
  bookingId: number;

  @ApiProperty({
    description: 'Refund amount in cents',
    example: 50000,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({
    description: 'Reason for refund',
    example: 'Customer requested cancellation',
  })
  @IsString()
  @IsOptional()
  reason?: string;
}
