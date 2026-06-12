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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  MessagePatterns as MP,
  Public,
  Roles,
  Role,
  CreateAirplaneDto,
  UpdateAirplaneDto,
  QueryAirplaneDto,
  ApiResponseDto,
  createHttpExceptionFromRpcError,
} from '@app/common';

@ApiTags('Airplanes')
@Controller('airplanes')
export class AirplaneController {
  private readonly logger = new Logger(AirplaneController.name);

  constructor(@Inject('FLIGHT_SERVICE') private readonly flightClient: ClientProxy) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new airplane' })
  async create(@Body() createAirplaneDto: CreateAirplaneDto) {
    const result = await this.callService(MP.AIRPLANE_CREATE, createAirplaneDto);
    return ApiResponseDto.success(result, 'airplane.create.success');
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'Get all airplanes with pagination' })
  async findAll(@Query() queryDto: QueryAirplaneDto) {
    const result = await this.callService(MP.AIRPLANE_FIND_ALL, queryDto);
    return ApiResponseDto.success(result, 'airplane.list.success');
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get airplane by ID' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.callService(MP.AIRPLANE_FIND_BY_ID, { id });
    return ApiResponseDto.success(result, 'airplane.get.success');
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update airplane' })
  async update(@Param('id', ParseIntPipe) id: number, @Body() updateAirplaneDto: UpdateAirplaneDto) {
    const result = await this.callService(MP.AIRPLANE_UPDATE, { id, updateAirplaneDto });
    return ApiResponseDto.success(result, 'airplane.update.success');
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete airplane' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.callService(MP.AIRPLANE_DELETE, { id });
    return ApiResponseDto.success(null, 'airplane.delete.success');
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
