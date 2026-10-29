import { ConflictException, Controller, UseFilters, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { FlightService } from '../services/flight.service';
import { SeatInventoryService, SeatReservationRejectedError } from '../services/seat-inventory.service';
import {
  MessagePatterns as MP,
  SharedCreateFlightDto,
  SharedSearchFlightDto,
  CommonRpcExceptionFilter,
  ReserveFlightSeatsDto,
  RpcValidationPipe,
  IdMessageDto,
} from '@app/common';

/**
 * RabbitMQ handlers for Flight operations. Clients reach these through the API gateway only.
 */
@Controller()
@UseFilters(CommonRpcExceptionFilter)
@UsePipes(RpcValidationPipe)
export class FlightController {
  constructor(
    private readonly flightService: FlightService,
    private readonly seatInventory: SeatInventoryService,
  ) {}

  @MessagePattern(MP.FLIGHT_CREATE)
  handleCreate(@Payload() createDto: SharedCreateFlightDto) {
    return this.flightService.create(createDto);
  }

  @MessagePattern(MP.FLIGHT_SEARCH)
  async handleSearch(@Payload() searchDto: SharedSearchFlightDto) {
    return this.flightService.search(searchDto);
  }

  @MessagePattern(MP.FLIGHT_FIND_BY_ID)
  handleFindOne(@Payload() data: IdMessageDto) {
    return this.flightService.findOne(data.id);
  }

  @MessagePattern(MP.FLIGHT_DELETE)
  handleDelete(@Payload() data: IdMessageDto) {
    return this.flightService.remove(data.id);
  }

  /**
   * Synchronous seat reservation for the booking saga. Replies with the fare so booking charges flight's price;
   * a rejection is a 409 the saga turns into a cancellation.
   */
  @MessagePattern(MP.FLIGHT_RESERVE_SEATS)
  async handleReserveSeats(@Payload() cmd: ReserveFlightSeatsDto) {
    try {
      const fare = await this.seatInventory.reserve({ ...cmd, eventId: cmd.reservationId });
      return { reserved: true, ...fare };
    } catch (error) {
      if (error instanceof SeatReservationRejectedError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }
}
