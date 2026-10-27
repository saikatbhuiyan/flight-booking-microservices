import { Controller, UseFilters, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CityService } from '../services/city.service';
import { CreateCityDto } from '../dto/create-city.dto';
import { UpdateCityDto } from '../dto/update-city.dto';
import { QueryCityDto } from '../dto/query-city.dto';
import { CommonRpcExceptionFilter, RpcValidationPipe, MessagePatterns as MP } from '@app/common';

/**
 * RabbitMQ handlers for City operations. Clients reach these through the API gateway only.
 */
@Controller()
@UseFilters(CommonRpcExceptionFilter)
@UsePipes(RpcValidationPipe)
export class CityController {
  constructor(private readonly cityService: CityService) {}

  @MessagePattern(MP.CITY_CREATE)
  async handleCreate(@Payload() createCityDto: CreateCityDto) {
    return this.cityService.create(createCityDto);
  }

  @MessagePattern(MP.CITY_FIND_ALL)
  async handleFindAll(@Payload() queryDto: QueryCityDto) {
    return this.cityService.findAll(queryDto);
  }

  @MessagePattern(MP.CITY_FIND_BY_ID)
  async handleFindOne(@Payload() data: { id: number }) {
    return this.cityService.findOne(data.id);
  }

  @MessagePattern(MP.CITY_UPDATE)
  async handleUpdate(@Payload() data: { id: number; updateCityDto: UpdateCityDto }) {
    return this.cityService.update(data.id, data.updateCityDto);
  }

  @MessagePattern(MP.CITY_DELETE)
  async handleDelete(@Payload() data: { id: number }) {
    return this.cityService.remove(data.id);
  }

  @MessagePattern(MP.CITY_STATISTICS)
  async handleStatistics() {
    return this.cityService.getStatistics();
  }

  @MessagePattern(MP.CITY_FIND_ALL_WITH_AIRPORT_COUNT)
  async handleFindAllWithAirportCount(@Payload() queryDto: QueryCityDto) {
    return this.cityService.findAllWithAirportCount(queryDto);
  }

  @MessagePattern(MP.CITY_RESTORE)
  async handleRestore(@Payload() data: { id: number }) {
    return this.cityService.restore(data.id);
  }
}
