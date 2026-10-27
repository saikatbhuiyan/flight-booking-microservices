import { Controller, UseFilters, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AirportService } from '../services/airport.service';
import { CreateAirportDto } from '../dto/create-airport.dto';
import { UpdateAirportDto } from '../dto/update-airport.dto';
import { QueryAirportDto } from '../dto/query-airport.dto';
import { CommonRpcExceptionFilter, RpcValidationPipe, MessagePatterns as MP } from '@app/common';

/**
 * RabbitMQ handlers for Airport operations. Clients reach these through the API gateway only.
 */
@Controller()
@UseFilters(CommonRpcExceptionFilter)
@UsePipes(RpcValidationPipe)
export class AirportController {
  constructor(private readonly airportService: AirportService) {}

  @MessagePattern(MP.AIRPORT_CREATE)
  async handleCreate(@Payload() createAirportDto: CreateAirportDto) {
    return this.airportService.create(createAirportDto);
  }

  @MessagePattern(MP.AIRPORT_FIND_ALL)
  async handleFindAll(@Payload() queryDto: QueryAirportDto) {
    return this.airportService.findAll(queryDto);
  }

  @MessagePattern(MP.AIRPORT_FIND_BY_ID)
  async handleFindOne(@Payload() data: { id: number }) {
    return this.airportService.findOne(data.id);
  }

  @MessagePattern(MP.AIRPORT_SEARCH)
  async handleSearch(@Payload() data: { code: string }) {
    return this.airportService.findByCode(data.code);
  }

  @MessagePattern(MP.AIRPORT_UPDATE)
  async handleUpdate(@Payload() data: { id: number; updateAirportDto: UpdateAirportDto }) {
    return this.airportService.update(data.id, data.updateAirportDto);
  }

  @MessagePattern(MP.AIRPORT_DELETE)
  async handleDelete(@Payload() data: { id: number }) {
    return this.airportService.remove(data.id);
  }

  @MessagePattern(MP.AIRPORT_STATISTICS)
  async handleStatistics() {
    return this.airportService.getStatistics();
  }
}
