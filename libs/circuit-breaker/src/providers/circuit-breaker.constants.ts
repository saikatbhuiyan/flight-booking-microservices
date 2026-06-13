import { ResolvedCircuitBreakerOptions } from '../interfaces';

export const CIRCUIT_BREAKER_OPTIONS = Symbol('CIRCUIT_BREAKER_OPTIONS');

export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: ResolvedCircuitBreakerOptions = {
  failureThreshold: 5,
  successThreshold: 2,
  openStateTimeoutMs: 30000, // 30 seconds
  rollingWindowMs: 60000, // 1 minute
  minimumRequestVolume: 5,
  halfOpenMaxConcurrentRequests: 1,
};
