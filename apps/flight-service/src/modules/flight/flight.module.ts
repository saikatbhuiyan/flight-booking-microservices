import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Flight } from '../../entities/flight.entity';
import { FlightController } from './controllers/flight.controller';
import { FlightService } from './services/flight.service';
import { FlightRepository } from './repositories/flight.repository';
import { AirplaneModule } from '../airplane/airplane.module';
import { AirportModule } from '../airport/airport.module';
import { FlightEventHandler } from './flight.event-handler';
import { SeatInventoryService } from './services/seat-inventory.service';
import { ProcessedEvent } from '../../entities/processed-events.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Flight, ProcessedEvent]), AirplaneModule, AirportModule],
  controllers: [FlightController],
  providers: [FlightService, FlightRepository, FlightEventHandler, SeatInventoryService],
  exports: [FlightService, FlightRepository],
})
export class FlightModule {}
