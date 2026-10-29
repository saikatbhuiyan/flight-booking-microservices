import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString } from 'class-validator';
import { CreateBookingDto } from './create-booking.dto';

/** booking.create: the public request plus the authenticated user the gateway resolved. */
export class CreateBookingMessageDto extends CreateBookingDto {
  @IsInt()
  @IsPositive()
  userId: number;
}

/** booking.* commands on an existing booking, on behalf of the authenticated user. */
export class BookingRefMessageDto {
  @IsString()
  @IsNotEmpty()
  bookingId: string;

  @IsInt()
  @IsPositive()
  userId: number;
}

export class CompleteBookingMessageDto extends BookingRefMessageDto {
  @IsString()
  @IsNotEmpty()
  paymentTransactionId: string;
}

export class CancelBookingMessageDto extends BookingRefMessageDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UserBookingsMessageDto {
  @IsInt()
  @IsPositive()
  userId: number;

  @IsOptional()
  @IsString()
  status?: string;
}

export class SeatAvailabilityMessageDto {
  @IsInt()
  @IsPositive()
  flightId: number;

  @IsString()
  seats: string;
}
