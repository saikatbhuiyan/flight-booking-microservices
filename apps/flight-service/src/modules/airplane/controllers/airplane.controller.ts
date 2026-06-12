import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AirplaneService } from '../services/airplane.service';
import { CreateAirplaneDto, UpdateAirplaneDto, QueryAirplaneDto } from '@app/common';
import { AirplaneResponseDto } from '../dto/airplane-response.dto';
import { ApiPaginatedResponse } from '../../../common/decorators/api-paginated-response.decorator';
import { MessagePatterns as MP } from '@app/common';

@ApiTags('Airplanes')
@Controller('airplanes')
export class AirplaneController {
  constructor(private readonly airplaneService: AirplaneService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new airplane' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AirplaneResponseDto })
  async create(@Body() createAirplaneDto: CreateAirplaneDto) {
    return this.airplaneService.create(createAirplaneDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all airplanes with pagination' })
  @ApiPaginatedResponse(AirplaneResponseDto)
  async findAll(@Query() queryDto: QueryAirplaneDto) {
    return this.airplaneService.findAll(queryDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get airplane by ID' })
  @ApiResponse({ status: HttpStatus.OK, type: AirplaneResponseDto })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.airplaneService.findOne(id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update airplane' })
  async update(@Param('id', ParseIntPipe) id: number, @Body() updateAirplaneDto: UpdateAirplaneDto) {
    return this.airplaneService.update(id, updateAirplaneDto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete airplane' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.airplaneService.remove(id);
  }

  // RabbitMQ Handlers
  @MessagePattern(MP.AIRPLANE_CREATE)
  handleCreate(@Payload() createAirplaneDto: CreateAirplaneDto) {
    return this.airplaneService.create(createAirplaneDto);
  }

  @MessagePattern(MP.AIRPLANE_FIND_ALL)
  handleFindAll(@Payload() queryDto: QueryAirplaneDto) {
    return this.airplaneService.findAll(queryDto);
  }

  @MessagePattern(MP.AIRPLANE_FIND_BY_ID)
  handleFindOne(@Payload() data: { id: number }) {
    return this.airplaneService.findOne(data.id);
  }

  @MessagePattern(MP.AIRPLANE_UPDATE)
  handleUpdate(@Payload() data: { id: number; updateAirplaneDto: UpdateAirplaneDto }) {
    return this.airplaneService.update(data.id, data.updateAirplaneDto);
  }

  @MessagePattern(MP.AIRPLANE_DELETE)
  handleDelete(@Payload() data: { id: number }) {
    return this.airplaneService.remove(data.id);
  }
}
