import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpStatus,
  UseFilters,
} from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { FlightService } from '../services/flight.service';
import {
  MessagePatterns as MP,
  SharedCreateFlightDto,
  SharedSearchFlightDto,
  CommonRpcExceptionFilter,
  Public,
} from '@app/common';

@ApiTags('Flights')
@Controller('flights')
@UseFilters(CommonRpcExceptionFilter)
export class FlightController {
  constructor(private readonly flightService: FlightService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new flight' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Flight created successfully' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input' })
  async create(@Body() createDto: SharedCreateFlightDto) {
    return this.flightService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Search for flights' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Flights found successfully' })
  async search(@Query() searchDto: SharedSearchFlightDto) {
    return this.flightService.search(searchDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get flight details by ID' })
  @ApiParam({ name: 'id', description: 'Flight ID', example: 1 })
  @ApiResponse({ status: HttpStatus.OK, description: 'Flight retrieved successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Flight not found' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.flightService.findOne(id);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a flight' })
  @ApiParam({ name: 'id', description: 'Flight ID', example: 1 })
  @ApiResponse({ status: HttpStatus.OK, description: 'Flight deleted successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Flight not found' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.flightService.remove(id);
  }

  // RabbitMQ Handlers
  @MessagePattern(MP.FLIGHT_CREATE)
  handleCreate(@Payload() createDto: SharedCreateFlightDto) {
    return this.flightService.create(createDto);
  }

  @Public()
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
