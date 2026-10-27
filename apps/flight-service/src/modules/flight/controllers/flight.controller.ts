import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { FlightService } from '../services/flight.service';
import {
  MessagePatterns as MP,
  SharedCreateFlightDto,
  SharedSearchFlightDto,
  CommonRpcExceptionFilter,
} from '@app/common';

/**
 * RabbitMQ handlers for Flight operations. Clients reach these through the API gateway only.
 */
@Controller()
@UseFilters(CommonRpcExceptionFilter)
export class FlightController {
  constructor(private readonly flightService: FlightService) {}

  @MessagePattern(MP.FLIGHT_CREATE)
  handleCreate(@Payload() createDto: SharedCreateFlightDto) {
    return this.flightService.create(createDto);
  }

  @MessagePattern(MP.FLIGHT_SEARCH)
  async handleSearch(@Payload() searchDto: SharedSearchFlightDto) {
    return this.flightService.search(searchDto);
  }

  @MessagePattern(MP.FLIGHT_FIND_BY_ID)
  handleFindOne(@Payload() data: { id: number }) {
    return this.flightService.findOne(data.id);
  }

  @MessagePattern(MP.FLIGHT_DELETE)
  handleDelete(@Payload() data: { id: number }) {
    return this.flightService.remove(data.id);
  }
}
