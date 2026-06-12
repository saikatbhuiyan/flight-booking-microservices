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
import { CityService } from '../services/city.service';
import { CreateCityDto } from '../dto/create-city.dto';
import { UpdateCityDto } from '../dto/update-city.dto';
import { QueryCityDto } from '../dto/query-city.dto';
import { CityResponseDto } from '../dto/city-response.dto';
import { ApiPaginatedResponse } from '../../../common/decorators/api-paginated-response.decorator';
import { MessagePatterns as MP } from '@app/common';

/**
 * Controller for City operations
 * Handles both HTTP and RabbitMQ message patterns
 */
@ApiTags('Cities')
@Controller('cities')
export class CityController {
  constructor(private readonly cityService: CityService) {}

  // ==================== HTTP Endpoints ====================

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new city' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'City created successfully',
    type: CityResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'City already exists',
  })
  async create(@Body() createCityDto: CreateCityDto): Promise<CityResponseDto> {
    return this.cityService.create(createCityDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all cities with pagination and filters' })
  @ApiPaginatedResponse(CityResponseDto)
  async findAll(@Query() queryDto: QueryCityDto) {
    return this.cityService.findAll(queryDto);
  }

  @Get('with-airport-count')
  @ApiOperation({ summary: 'Get all cities with airport count' })
  @ApiPaginatedResponse(CityResponseDto)
  async findAllWithAirportCount(@Query() queryDto: QueryCityDto) {
    return this.cityService.findAllWithAirportCount(queryDto);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Get city statistics' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'City statistics retrieved successfully',
  })
  async getStatistics() {
    return this.cityService.getStatistics();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get city by ID' })
  @ApiParam({ name: 'id', description: 'City ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'City retrieved successfully',
    type: CityResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'City not found',
  })
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<CityResponseDto> {
    return this.cityService.findOne(id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update city' })
  @ApiParam({ name: 'id', description: 'City ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'City updated successfully',
    type: CityResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'City not found',
  })
  async update(@Param('id', ParseIntPipe) id: number, @Body() updateCityDto: UpdateCityDto): Promise<CityResponseDto> {
    return this.cityService.update(id, updateCityDto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete city' })
  @ApiParam({ name: 'id', description: 'City ID' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'City deleted successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'City not found',
  })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.cityService.remove(id);
  }

  @Patch(':id/restore')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Restore soft-deleted city' })
  @ApiParam({ name: 'id', description: 'City ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'City restored successfully',
    type: CityResponseDto,
  })
  async restore(@Param('id', ParseIntPipe) id: number): Promise<CityResponseDto> {
    return this.cityService.restore(id);
  }

  // ==================== RabbitMQ Message Patterns ====================

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
}
