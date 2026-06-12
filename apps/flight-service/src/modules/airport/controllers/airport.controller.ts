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
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AirportService } from '../services/airport.service';
import { CreateAirportDto } from '../dto/create-airport.dto';
import { UpdateAirportDto } from '../dto/update-airport.dto';
import { QueryAirportDto } from '../dto/query-airport.dto';
import { AirportResponseDto } from '../dto/airport-response.dto';
import { ApiPaginatedResponse } from '../../../common/decorators/api-paginated-response.decorator';
import { MessagePatterns as MP } from '@app/common';

@ApiTags('Airports')
@Controller('airports')
export class AirportController {
  constructor(private readonly airportService: AirportService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new airport' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Airport created successfully',
    type: AirportResponseDto,
  })
  async create(@Body() createAirportDto: CreateAirportDto): Promise<AirportResponseDto> {
    return this.airportService.create(createAirportDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all airports with pagination and filters' })
  @ApiPaginatedResponse(AirportResponseDto)
  async findAll(@Query() queryDto: QueryAirportDto) {
    return this.airportService.findAll(queryDto);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search airports by code' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Airport found',
    type: AirportResponseDto,
  })
  async searchByCode(@Query('code') code: string): Promise<AirportResponseDto> {
    return this.airportService.findByCode(code);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Get airport statistics' })
  async getStatistics() {
    return this.airportService.getStatistics();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get airport by ID' })
  @ApiParam({ name: 'id', description: 'Airport ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Airport retrieved successfully',
    type: AirportResponseDto,
  })
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<AirportResponseDto> {
    return this.airportService.findOne(id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update airport' })
  @ApiParam({ name: 'id', description: 'Airport ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Airport updated successfully',
    type: AirportResponseDto,
  })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateAirportDto: UpdateAirportDto,
  ): Promise<AirportResponseDto> {
    return this.airportService.update(id, updateAirportDto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete airport' })
  @ApiParam({ name: 'id', description: 'Airport ID' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.airportService.remove(id);
  }

  // RabbitMQ Message Patterns
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
}
