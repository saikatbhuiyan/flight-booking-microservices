import { DynamicModule, Global, Module } from '@nestjs/common';
import { CircuitBreakerOptions } from './interfaces';
import { CIRCUIT_BREAKER_OPTIONS } from './providers/circuit-breaker.constants';
import { CircuitBreakerService } from './providers/circuit-breaker.service';

@Global()
@Module({
  providers: [CircuitBreakerService],
  exports: [CircuitBreakerService],
})
export class CircuitBreakerModule {
  static forRoot(options: CircuitBreakerOptions = {}): DynamicModule {
    return {
      module: CircuitBreakerModule,
      providers: [
        {
          provide: CIRCUIT_BREAKER_OPTIONS,
          useValue: options,
        },
        CircuitBreakerService,
      ],
      exports: [CircuitBreakerService],
      global: true,
    };
  }
}
