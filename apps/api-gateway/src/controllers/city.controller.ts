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
  CreateCityDto,
  UpdateCityDto,
  QueryCityDto,
  ApiResponseDto,
  createHttpExceptionFromRpcError,
} from '@app/common';

/**
 * API Gateway controller for City operations
 * Proxies requests to flight-service via RabbitMQ
 */
@ApiTags('Cities')
@Controller('cities')
export class CityController {
  private readonly logger = new Logger(CityController.name);

  constructor(@Inject('FLIGHT_SERVICE') private readonly flightClient: ClientProxy) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new city' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'City created successfully',
  })
  async create(@Body() createCityDto: CreateCityDto) {
    const result = await this.callService(MP.CITY_CREATE, createCityDto);
    return ApiResponseDto.success(result, 'city.create.success');
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'Get all cities with pagination' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cities retrieved successfully',
  })
  async findAll(@Query() queryDto: QueryCityDto) {
    const result = await this.callService(MP.CITY_FIND_ALL, queryDto);
    return ApiResponseDto.success(result, 'city.list.success');
  }

  @Get('statistics')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get city statistics' })
  async getStatistics() {
    const result = await this.callService(MP.CITY_STATISTICS, {});
    return ApiResponseDto.success(result, 'city.statistics.success');
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get city by ID' })
  @ApiParam({ name: 'id', description: 'City ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'City retrieved successfully',
  })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.callService(MP.CITY_FIND_BY_ID, { id });
    return ApiResponseDto.success(result, 'city.get.success');
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update city' })
  @ApiParam({ name: 'id', description: 'City ID' })
  async update(@Param('id', ParseIntPipe) id: number, @Body() updateCityDto: UpdateCityDto) {
    const result = await this.callService(MP.CITY_UPDATE, { id, updateCityDto });
    return ApiResponseDto.success(result, 'city.update.success');
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete city' })
  @ApiParam({ name: 'id', description: 'City ID' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.callService(MP.CITY_DELETE, { id });
    return ApiResponseDto.success(null, 'city.delete.success');
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
