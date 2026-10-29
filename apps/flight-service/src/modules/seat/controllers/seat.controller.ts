import { Controller, UseFilters, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { SeatService } from '../services/seat.service';
import {
  CommonRpcExceptionFilter,
  RpcValidationPipe,
  CreateSeatDto,
  BulkCreateSeatsDto,
  MessagePatterns as MP,
  IdMessageDto,
  AirplaneSeatsMessageDto,
} from '@app/common';

/**
 * RabbitMQ handlers for Seat operations. Clients reach these through the API gateway only.
 */
@Controller()
@UseFilters(CommonRpcExceptionFilter)
@UsePipes(RpcValidationPipe)
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
  handleGetByAirplane(@Payload() data: AirplaneSeatsMessageDto) {
    return this.seatService.findByAirplane(data.airplaneId);
  }

  @MessagePattern(MP.SEAT_DELETE)
  handleDelete(@Payload() data: IdMessageDto) {
    return this.seatService.remove(data.id);
  }
}
