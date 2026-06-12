import { Controller, Get, Post, Body, Param, Delete, Inject, ParseIntPipe, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  MessagePatterns as MP,
  Public,
  Roles,
  Role,
  CreateSeatDto,
  BulkCreateSeatsDto,
  ApiResponseDto,
  createHttpExceptionFromRpcError,
} from '@app/common';

@ApiTags('Seats')
@Controller('seats')
export class SeatController {
  private readonly logger = new Logger(SeatController.name);

  constructor(@Inject('FLIGHT_SERVICE') private readonly flightClient: ClientProxy) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new seat' })
  async create(@Body() createSeatDto: CreateSeatDto) {
    const result = await this.callService(MP.SEAT_CREATE, createSeatDto);
    return ApiResponseDto.success(result, 'seat.create.success');
  }

  @Post('bulk')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk create seats for an airplane' })
  async bulkCreate(@Body() bulkDto: BulkCreateSeatsDto) {
    const result = await this.callService(MP.SEAT_BULK_CREATE, bulkDto);
    return ApiResponseDto.success(result, 'seat.bulk_create.success');
  }

  @Get('airplane/:airplaneId')
  @Public()
  @ApiOperation({ summary: 'Get all seats for an airplane' })
  async findByAirplane(@Param('airplaneId', ParseIntPipe) airplaneId: number) {
    const result = await this.callService(MP.AIRPLANE_GET_SEATS, { airplaneId });
    return ApiResponseDto.success(result, 'seat.list.success');
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a seat' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.callService(MP.SEAT_DELETE, { id });
    return ApiResponseDto.success(null, 'seat.delete.success');
  }

  private async callService<TResult, TInput>(pattern: string, data: TInput): Promise<TResult> {
    try {
      return await firstValueFrom(this.flightClient.send<TResult>(pattern, data));
    } catch (error) {
      this.logger.error(`Error calling ${pattern}`, JSON.stringify(error, null, 2));
      throw createHttpExceptionFromRpcError(error);
    }
  }
}
