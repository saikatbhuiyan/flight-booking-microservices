import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@app/database';
import {
  HealthModule,
  CommonModule,
  GlobalExceptionFilter,
  winstonLoggerConfig,
  LoggingInterceptor,
} from '@app/common';
import { WinstonModule } from 'nest-winston';
import authConfig from '@app/common/config/auth.config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Flight } from './entities/flight.entity';
import { City } from './entities/city.entity';
import { Airport } from './entities/airport.entity';
import { Airplane } from './entities/airplane.entity';
import { Seat } from './entities/seat.entity';
import { ProcessedEvent } from './entities/processed-events.entity';
import { CityModule } from './modules/city/city.module';
import { AirportModule } from './modules/airport/airport.module';
import { AirplaneModule } from './modules/airplane/airplane.module';
import { SeatModule } from './modules/seat/seat.module';
import { FlightModule } from './modules/flight/flight.module';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { rabbitmqConfig } from './config/rabbitmq.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [authConfig],
      envFilePath: ['apps/flight-service/.env', '.env'],
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
    DatabaseModule.forRoot(
      [Flight, City, Airport, Airplane, Seat, ProcessedEvent],
      [__dirname + '/migrations/*.{ts,js}'],
    ),
    TypeOrmModule.forFeature([Flight, City, Airport, Airplane, Seat, ProcessedEvent]),
    CommonModule,
    WinstonModule.forRoot(winstonLoggerConfig),
    HealthModule,
    RabbitMQModule.forRoot(rabbitmqConfig),
    CityModule,
    AirportModule,
    AirplaneModule,
    SeatModule,
    FlightModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class FlightServiceModule {}
