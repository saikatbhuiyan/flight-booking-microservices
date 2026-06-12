import { Controller, Get, Post, Body, Param, Delete, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { SeatService } from '../services/seat.service';
import { CreateSeatDto, BulkCreateSeatsDto, MessagePatterns as MP } from '@app/common';

@ApiTags('Seats')
@Controller('seats')
export class SeatController {
  constructor(private readonly seatService: SeatService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new seat' })
  async create(@Body() createSeatDto: CreateSeatDto) {
    return this.seatService.create(createSeatDto);
  }

  @Post('bulk')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk create seats for an airplane' })
  async bulkCreate(@Body() bulkDto: BulkCreateSeatsDto) {
    return this.seatService.bulkCreate(bulkDto);
  }

  @Get('airplane/:airplaneId')
  @ApiOperation({ summary: 'Get all seats for an airplane' })
  async findByAirplane(@Param('airplaneId', ParseIntPipe) airplaneId: number) {
    return this.seatService.findByAirplane(airplaneId);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a seat' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.seatService.remove(id);
  }

  // RabbitMQ Handlers
  @MessagePattern(MP.SEAT_CREATE)
  handleCreate(@Payload() createSeatDto: CreateSeatDto) {
    return this.seatService.create(createSeatDto);
  }

  @MessagePattern(MP.SEAT_BULK_CREATE)
  handleBulkCreate(@Payload() bulkDto: BulkCreateSeatsDto) {
    return this.seatService.bulkCreate(bulkDto);
  }

  @MessagePattern(MP.AIRPLANE_GET_SEATS)
  handleGetByAirplane(@Payload() data: { airplaneId: number }) {
    return this.seatService.findByAirplane(data.airplaneId);
  }

  @MessagePattern(MP.SEAT_DELETE)
  handleDelete(@Payload() data: { id: number }) {
    return this.seatService.remove(data.id);
  }
}
