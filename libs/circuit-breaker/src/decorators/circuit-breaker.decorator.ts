import { SetMetadata } from '@nestjs/common';
import { CircuitBreakerOptions } from '../interfaces';

export const CIRCUIT_BREAKER_METADATA = 'circuit-breaker:options';

export interface CircuitBreakerMetadata extends CircuitBreakerOptions {
  name: string;
}

export const CircuitBreaker = (metadata: CircuitBreakerMetadata) => SetMetadata(CIRCUIT_BREAKER_METADATA, metadata);
