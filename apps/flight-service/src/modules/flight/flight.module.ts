import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Flight } from '../../entities/flight.entity';
import { FlightController } from './controllers/flight.controller';
import { FlightService } from './services/flight.service';
import { FlightRepository } from './repositories/flight.repository';
import { AirplaneModule } from '../airplane/airplane.module';
import { AirportModule } from '../airport/airport.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { FlightEventHandler } from './flight.event-handler';
import { ProcessedEvent } from '../../entities/processed-events.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Flight, ProcessedEvent]),
    AirplaneModule,
    AirportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_ACCESS_EXPIRATION') as any,
        },
      }),
      inject: [ConfigService],
    }),
    ClientsModule.registerAsync([
      {
        name: 'AUTH_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.get<string>('RABBITMQ_URL')],
            queue: 'auth_queue',
            queueOptions: {
              durable: true,
              arguments: {
                'x-dead-letter-exchange': '',
                'x-dead-letter-routing-key': 'auth_queue_retry',
                'x-max-length': 10000,
              },
            },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [FlightController],
  providers: [FlightService, FlightRepository, FlightEventHandler],
  exports: [FlightService, FlightRepository],
})
export class FlightModule {}
