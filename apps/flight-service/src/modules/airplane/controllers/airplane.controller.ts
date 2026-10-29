import { Controller, UseFilters, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AirplaneService } from '../services/airplane.service';
import {
  CommonRpcExceptionFilter,
  RpcValidationPipe,
  CreateAirplaneDto,
  MessagePatterns as MP,
  QueryAirplaneDto,
  IdMessageDto,
  UpdateAirplaneMessageDto,
} from '@app/common';

/**
 * RabbitMQ handlers for Airplane operations. Clients reach these through the API gateway only.
 */
@Controller()
@UseFilters(CommonRpcExceptionFilter)
@UsePipes(RpcValidationPipe)
export class AirplaneController {
  constructor(private readonly airplaneService: AirplaneService) {}

  @MessagePattern(MP.AIRPLANE_CREATE)
  handleCreate(@Payload() createAirplaneDto: CreateAirplaneDto) {
    return this.airplaneService.create(createAirplaneDto);
  }

  @MessagePattern(MP.AIRPLANE_FIND_ALL)
  handleFindAll(@Payload() queryDto: QueryAirplaneDto) {
    return this.airplaneService.findAll(queryDto);
  }

  @MessagePattern(MP.AIRPLANE_FIND_BY_ID)
  handleFindOne(@Payload() data: IdMessageDto) {
    return this.airplaneService.findOne(data.id);
  }

  @MessagePattern(MP.AIRPLANE_UPDATE)
  handleUpdate(@Payload() data: UpdateAirplaneMessageDto) {
    return this.airplaneService.update(data.id, data.updateAirplaneDto);
  }

  @MessagePattern(MP.AIRPLANE_DELETE)
  handleDelete(@Payload() data: IdMessageDto) {
    return this.airplaneService.remove(data.id);
  }
}
