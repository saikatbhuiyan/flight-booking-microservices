import {
  Controller,
  Get,
  Query,
  Param,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Body,
  Delete,
  ParseIntPipe,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  MessagePatterns as MP,
  ApiResponseDto,
  Public,
  Roles,
  Role,
  SharedCreateFlightDto,
  SharedSearchFlightDto,
  createHttpExceptionFromRpcError,
} from '@app/common';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Flights')
@Controller('flights')
export class FlightController {
  private readonly logger = new Logger(FlightController.name);

  constructor(@Inject('FLIGHT_SERVICE') private readonly flightClient: ClientProxy) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Search for flights' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns a list of matching flights',
    type: ApiResponseDto,
  })
  async searchFlights(@Query() searchDto: SharedSearchFlightDto) {
    const result = await this.callService(MP.FLIGHT_SEARCH, searchDto);
    return ApiResponseDto.success(result, 'flight.list.success');
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get flight details by ID' })
  @ApiParam({ name: 'id', description: 'Flight ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the flight details',
    type: ApiResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Flight not found',
  })
  async getFlightById(@Param('id', ParseIntPipe) id: number) {
    const result = await this.callService(MP.FLIGHT_FIND_BY_ID, { id });
    return ApiResponseDto.success(result, 'flight.get.success');
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new flight' })
  async create(@Body() createDto: SharedCreateFlightDto) {
    const result = await this.callService(MP.FLIGHT_CREATE, createDto);
    return ApiResponseDto.success(result, 'flight.create.success');
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a flight' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.callService(MP.FLIGHT_DELETE, { id });
    return ApiResponseDto.success(null, 'flight.delete.success');
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
