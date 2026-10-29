import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ example: '1', description: 'ID of the flight' })
  @IsString()
  @IsNotEmpty()
  flightId: string;

  @ApiProperty({ example: 1, description: 'Number of seats to book' })
  @IsNumber()
  @IsNotEmpty()
  seats: number;

  @ApiPropertyOptional({ example: 'window', description: 'Seat preference' })
  @IsString()
  @IsOptional()
  seatPreference?: string;

  @ApiPropertyOptional({ example: 'ECONOMY', description: 'Seat class' })
  @IsString()
  @IsOptional()
  seatClass?: string;

  @ApiPropertyOptional({
    example: ['1A'],
    description: 'Specific seat numbers',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  seatNumbers?: string[];
}
