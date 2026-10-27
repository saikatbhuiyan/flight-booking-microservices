import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { SeatService } from '../services/seat.service';
import { CommonRpcExceptionFilter, CreateSeatDto, BulkCreateSeatsDto, MessagePatterns as MP } from '@app/common';

/**
 * RabbitMQ handlers for Seat operations. Clients reach these through the API gateway only.
 */
@Controller()
@UseFilters(CommonRpcExceptionFilter)
export class SeatController {
  constructor(private readonly seatService: SeatService) {}

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
