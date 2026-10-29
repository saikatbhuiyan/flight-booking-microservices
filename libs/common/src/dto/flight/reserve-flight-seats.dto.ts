import { IsInt, IsNotEmpty, IsPositive, IsString } from 'class-validator';

/** flight.reserveSeats RPC payload: booking-service reserving seats synchronously during the booking saga. */
export class ReserveFlightSeatsDto {
  /** Idempotency key; retries with the same id get the same answer. */
  @IsString()
  @IsNotEmpty()
  reservationId: string;

  @IsString()
  @IsNotEmpty()
  bookingId: string;

  @IsInt()
  @IsPositive()
  flightId: number;

  @IsString()
  @IsNotEmpty()
  seatClass: string;

  @IsInt()
  @IsPositive()
  seatCount: number;
}
