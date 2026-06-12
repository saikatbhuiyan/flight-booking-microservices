import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpStatus,
  Inject,
  ParseIntPipe,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import {
  MessagePatterns as MP,
  Public,
  Roles,
  Role,
  CreateAirportDto,
  UpdateAirportDto,
  QueryAirportDto,
  ApiResponseDto,
  createHttpExceptionFromRpcError,
} from '@app/common';

/**
 * API Gateway controller for Airport operations
 * Proxies requests to flight-service via RabbitMQ
 */
@ApiTags('Airports')
@Controller('airports')
export class AirportController {
  private readonly logger = new Logger(AirportController.name);

  constructor(@Inject('FLIGHT_SERVICE') private readonly flightClient: ClientProxy) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new airport' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Airport created successfully',
  })
  async create(@Body() createAirportDto: CreateAirportDto) {
    const result = await this.callService(MP.AIRPORT_CREATE, createAirportDto);
    return ApiResponseDto.success(result, 'airport.create.success');
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'Get all airports with pagination' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Airports retrieved successfully',
  })
  async findAll(@Query() queryDto: QueryAirportDto) {
    const result = await this.callService(MP.AIRPORT_FIND_ALL, queryDto);
    return ApiResponseDto.success(result, 'airport.list.success');
  }

  @Get('search')
  @Public()
  @ApiOperation({ summary: 'Search airports by code' })
  async searchByCode(@Query('code') code: string) {
    const result = await this.callService(MP.AIRPORT_SEARCH, { code });
    return ApiResponseDto.success(result, 'airport.search.success');
  }

  @Get('statistics')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get airport statistics' })
  async getStatistics() {
    const result = await this.callService(MP.AIRPORT_FIND_ALL, { limit: 0 });
    return ApiResponseDto.success(result, 'airport.statistics.success');
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get airport by ID' })
  @ApiParam({ name: 'id', description: 'Airport ID' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.callService(MP.AIRPORT_FIND_BY_ID, { id });
    return ApiResponseDto.success(result, 'airport.get.success');
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update airport' })
  @ApiParam({ name: 'id', description: 'Airport ID' })
  async update(@Param('id', ParseIntPipe) id: number, @Body() updateAirportDto: UpdateAirportDto) {
    const result = await this.callService(MP.AIRPORT_UPDATE, { id, updateAirportDto });
    return ApiResponseDto.success(result, 'airport.update.success');
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete airport' })
  @ApiParam({ name: 'id', description: 'Airport ID' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.callService(MP.AIRPORT_DELETE, { id });
    return ApiResponseDto.success(null, 'airport.delete.success');
  }

  private async callService<TResult, TInput>(pattern: string, data: TInput): Promise<TResult> {
    try {
      return await firstValueFrom(this.flightClient.send<TResult>(pattern, data));
    } catch (error) {
      this.logger.error(`Error calling ${pattern}`, JSON.stringify(error, null, 2));
      throw createHttpExceptionFromRpcError(error);
    }
  }
}
