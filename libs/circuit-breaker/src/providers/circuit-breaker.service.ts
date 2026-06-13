import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CircuitBreakerExecuteOptions,
  CircuitBreakerOptions,
  CircuitBreakerSnapshot,
  CircuitBreakerState,
  ResolvedCircuitBreakerOptions,
} from '../interfaces';
import { CircuitBreakerOpenError } from '../errors';
import { CIRCUIT_BREAKER_OPTIONS, DEFAULT_CIRCUIT_BREAKER_OPTIONS } from './circuit-breaker.constants';

interface CircuitRecord {
  name: string;
  state: CircuitBreakerState;
  options: ResolvedCircuitBreakerOptions;
  failures: number;
  successes: number;
  requests: number;
  halfOpenInFlight: number;
  windowStartedAt: number;
  openedAt?: number;
}

@Injectable()
export class CircuitBreakerService {
  private readonly circuits = new Map<string, CircuitRecord>();
  private readonly defaults: ResolvedCircuitBreakerOptions;

  constructor(@Optional() @Inject(CIRCUIT_BREAKER_OPTIONS) options: CircuitBreakerOptions = {}) {
    this.defaults = this.resolveOptions(options);
  }

  async execute<TResult>(
    name: string,
    operation: () => Promise<TResult> | TResult,
    options: CircuitBreakerExecuteOptions<TResult> = {},
  ): Promise<TResult> {
    const circuit = this.getCircuit(name, options);
    const now = Date.now();

    this.refreshWindow(circuit, now);
    this.transitionOpenIfReady(circuit, now);

    if (circuit.state === CircuitBreakerState.OPEN) {
      const error = this.createOpenError(circuit);
      return this.handleFallback(error, options);
    }

    if (
      circuit.state === CircuitBreakerState.HALF_OPEN &&
      circuit.halfOpenInFlight >= circuit.options.halfOpenMaxConcurrentRequests
    ) {
      const error = this.createOpenError(circuit);
      return this.handleFallback(error, options);
    }

    circuit.requests += 1;
    if (circuit.state === CircuitBreakerState.HALF_OPEN) {
      circuit.halfOpenInFlight += 1;
    }

    try {
      const result = await operation();
      this.recordSuccess(circuit);
      return result;
    } catch (error) {
      this.recordFailure(circuit);
      return this.handleFallback(error, options);
    } finally {
      if (circuit.state === CircuitBreakerState.HALF_OPEN && circuit.halfOpenInFlight > 0) {
        circuit.halfOpenInFlight -= 1;
      }
    }
  }

  getSnapshot(name: string): CircuitBreakerSnapshot | undefined {
    const circuit = this.circuits.get(name);
    return circuit ? this.toSnapshot(circuit) : undefined;
  }

  getSnapshots(): CircuitBreakerSnapshot[] {
    return Array.from(this.circuits.values()).map((circuit) => this.toSnapshot(circuit));
  }

  reset(name?: string): void {
    if (name) {
      this.circuits.delete(name);
      return;
    }

    this.circuits.clear();
  }

  private getCircuit(name: string, options: CircuitBreakerOptions): CircuitRecord {
    const existing = this.circuits.get(name);
    if (existing) {
      existing.options = this.resolveOptions(options);
      return existing;
    }

    const now = Date.now();
    const circuit: CircuitRecord = {
      name,
      state: CircuitBreakerState.CLOSED,
      options: this.resolveOptions(options),
      failures: 0,
      successes: 0,
      requests: 0,
      halfOpenInFlight: 0,
      windowStartedAt: now,
    };

    this.circuits.set(name, circuit);
    return circuit;
  }

  private resolveOptions(options: CircuitBreakerOptions = {}): ResolvedCircuitBreakerOptions {
    return {
      ...DEFAULT_CIRCUIT_BREAKER_OPTIONS,
      ...this.defaults,
      ...options,
    };
  }

  private refreshWindow(circuit: CircuitRecord, now: number): void {
    if (circuit.state !== CircuitBreakerState.CLOSED) {
      return;
    }

    if (now - circuit.windowStartedAt <= circuit.options.rollingWindowMs) {
      return;
    }

    circuit.failures = 0;
    circuit.successes = 0;
    circuit.requests = 0;
    circuit.windowStartedAt = now;
  }

  private transitionOpenIfReady(circuit: CircuitRecord, now: number): void {
    if (circuit.state !== CircuitBreakerState.OPEN || !circuit.openedAt) {
      return;
    }

    if (now - circuit.openedAt < circuit.options.openStateTimeoutMs) {
      return;
    }

    circuit.state = CircuitBreakerState.HALF_OPEN;
    circuit.successes = 0;
    circuit.failures = 0;
    circuit.requests = 0;
    circuit.halfOpenInFlight = 0;
    circuit.windowStartedAt = now;
  }

  private recordSuccess(circuit: CircuitRecord): void {
    if (circuit.state === CircuitBreakerState.HALF_OPEN) {
      circuit.successes += 1;

      if (circuit.successes >= circuit.options.successThreshold) {
        this.close(circuit);
      }

      return;
    }

    circuit.successes += 1;
    circuit.failures = 0;
  }

  private recordFailure(circuit: CircuitRecord): void {
    circuit.failures += 1;

    if (circuit.state === CircuitBreakerState.HALF_OPEN) {
      this.open(circuit);
      return;
    }

    if (
      circuit.requests >= circuit.options.minimumRequestVolume &&
      circuit.failures >= circuit.options.failureThreshold
    ) {
      this.open(circuit);
    }
  }

  private open(circuit: CircuitRecord): void {
    circuit.state = CircuitBreakerState.OPEN;
    circuit.openedAt = Date.now();
    circuit.halfOpenInFlight = 0;
  }

  private close(circuit: CircuitRecord): void {
    circuit.state = CircuitBreakerState.CLOSED;
    circuit.failures = 0;
    circuit.successes = 0;
    circuit.requests = 0;
    circuit.halfOpenInFlight = 0;
    circuit.openedAt = undefined;
    circuit.windowStartedAt = Date.now();
  }

  private createOpenError(circuit: CircuitRecord): CircuitBreakerOpenError {
    const openedAt = circuit.openedAt ?? Date.now();
    const retryAt = new Date(openedAt + circuit.options.openStateTimeoutMs);
    return new CircuitBreakerOpenError(circuit.name, retryAt);
  }

  private async handleFallback<TResult>(
    error: unknown,
    options: CircuitBreakerExecuteOptions<TResult>,
  ): Promise<TResult> {
    if (options.fallback) {
      return options.fallback(error);
    }

    throw error;
  }

  private toSnapshot(circuit: CircuitRecord): CircuitBreakerSnapshot {
    return {
      name: circuit.name,
      state: circuit.state,
      failures: circuit.failures,
      successes: circuit.successes,
      requests: circuit.requests,
      halfOpenInFlight: circuit.halfOpenInFlight,
      windowStartedAt: circuit.windowStartedAt,
      openedAt: circuit.openedAt,
      nextAttemptAt: circuit.openedAt ? circuit.openedAt + circuit.options.openStateTimeoutMs : undefined,
    };
  }
}
