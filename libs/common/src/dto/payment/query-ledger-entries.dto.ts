import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryLedgerEntriesDto {
  @ApiPropertyOptional({ example: 123 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  bookingId?: number;

  @ApiPropertyOptional({ example: '5b4f5857-f9a4-4205-8b7c-1a2d54d1258e' })
  @IsOptional()
  @IsString()
  paymentId?: string;

  @ApiPropertyOptional({ example: 'payment' })
  @IsOptional()
  @IsString()
  entryType?: string;

  @ApiPropertyOptional({ example: '2026-05-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-05-31T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ example: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}
