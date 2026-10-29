import { Controller, UseFilters, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AirportService } from '../services/airport.service';
import { CreateAirportDto } from '../dto/create-airport.dto';
import { QueryAirportDto } from '../dto/query-airport.dto';
import {
  CommonRpcExceptionFilter,
  RpcValidationPipe,
  MessagePatterns as MP,
  IdMessageDto,
  UpdateAirportMessageDto,
  AirportCodeMessageDto,
} from '@app/common';

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
  async handleFindOne(@Payload() data: IdMessageDto) {
    return this.airportService.findOne(data.id);
  }

  @MessagePattern(MP.AIRPORT_SEARCH)
  async handleSearch(@Payload() data: AirportCodeMessageDto) {
    return this.airportService.findByCode(data.code);
  }

  @MessagePattern(MP.AIRPORT_UPDATE)
  async handleUpdate(@Payload() data: UpdateAirportMessageDto) {
    return this.airportService.update(data.id, data.updateAirportDto);
  }

  @MessagePattern(MP.AIRPORT_DELETE)
  async handleDelete(@Payload() data: IdMessageDto) {
    return this.airportService.remove(data.id);
  }

  @MessagePattern(MP.AIRPORT_STATISTICS)
  async handleStatistics() {
    return this.airportService.getStatistics();
  }
}
