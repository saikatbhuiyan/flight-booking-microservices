import { CircuitBreakerState } from './circuit-breaker-state.enum';

export interface CircuitBreakerSnapshot {
  name: string;
  state: CircuitBreakerState;
  failures: number;
  successes: number;
  requests: number;
  halfOpenInFlight: number;
  windowStartedAt: number;
  openedAt?: number;
  nextAttemptAt?: number;
}
