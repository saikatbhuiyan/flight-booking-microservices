import { Controller, Get, Post, Put, Body, Param, Query, HttpStatus, Inject, Logger, UseGuards } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  MessagePatterns as MP,
  ApiResponseDto,
  CreateBookingDto,
  CurrentUser,
  JwtAuthGuard,
  createHttpExceptionFromRpcError,
} from '@app/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiParam } from '@nestjs/swagger';

@ApiTags('Bookings')
@Controller('bookings')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class BookingController {
  private readonly logger = new Logger(BookingController.name);

  constructor(@Inject('BOOKING_SERVICE') private readonly bookingClient: ClientProxy) {}

  @Post()
  @ApiOperation({ summary: 'Create a new flight booking' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Booking created successfully',
    type: ApiResponseDto,
  })
  async createBooking(@Body() createDto: CreateBookingDto, @CurrentUser() user: any) {
    const result = await this.callService(MP.BOOKING_CREATE, {
      ...createDto,
      userId: user.id,
    });
    return ApiResponseDto.success(result, 'booking.create.success');
  }

  @Post(':bookingId/complete')
  @ApiOperation({ summary: 'Complete booking after payment' })
  async completeBooking(
    @Param('bookingId') bookingId: string,
    @Body() paymentDto: { paymentTransactionId: string },
    @CurrentUser() user: any,
  ) {
    const result = await this.callService(MP.BOOKING_COMPLETE, {
      bookingId,
      userId: user.id,
      paymentTransactionId: paymentDto.paymentTransactionId,
    });
    return ApiResponseDto.success(result, 'booking.confirm.success');
  }

  @Put(':bookingId/cancel')
  @ApiOperation({ summary: 'Cancel a booking' })
  async cancelBooking(
    @Param('bookingId') bookingId: string,
    @Body() cancelDto: { reason?: string },
    @CurrentUser() user: any,
  ) {
    const result = await this.callService(MP.BOOKING_CANCEL, {
      bookingId,
      userId: user.id,
      reason: cancelDto.reason,
    });
    return ApiResponseDto.success(result, 'booking.cancel.success');
  }

  @Put(':bookingId/extend')
  @ApiOperation({ summary: 'Extend booking expiry' })
  async extendBooking(@Param('bookingId') bookingId: string, @CurrentUser() user: any) {
    const result = await this.callService(MP.BOOKING_EXTEND, {
      bookingId,
      userId: user.id,
    });
    return ApiResponseDto.success(result, 'booking.extend.success');
  }

  @Get('my-bookings')
  @ApiOperation({ summary: 'Get my bookings' })
  async getMyBookings(@CurrentUser() user: any) {
    const result = await this.callService(MP.BOOKING_FIND_BY_USER, {
      userId: user.id,
    });
    return ApiResponseDto.success(result, 'booking.list.success');
  }

  @Get(':bookingId')
  @ApiOperation({ summary: 'Get booking details' })
  @ApiParam({ name: 'bookingId', description: 'Booking ID' })
  async getBooking(@Param('bookingId') bookingId: string, @CurrentUser() user: any) {
    const result = await this.callService(MP.BOOKING_FIND_BY_ID, {
      bookingId,
      userId: user.id,
    });
    return ApiResponseDto.success(result, 'booking.get.success');
  }

  @Get('flights/:flightId/seats/availability')
  @ApiOperation({ summary: 'Check seat availability' })
  async checkSeatAvailability(@Param('flightId') flightId: number, @Query('seats') seats: string) {
    const result = await this.callService(MP.BOOKING_CHECK_AVAILABILITY, {
      flightId,
      seats,
    });
    return ApiResponseDto.success(result, 'booking.availability.success');
  }

  private async callService<TResult, TInput>(pattern: string, data: TInput): Promise<TResult> {
    try {
      return await firstValueFrom(this.bookingClient.send<TResult>(pattern, data));
    } catch (error) {
      this.logger.error(`Error calling ${pattern}`, JSON.stringify(error, null, 2));
      throw createHttpExceptionFromRpcError(error);
    }
  }
}
