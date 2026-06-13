export interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  openStateTimeoutMs?: number;
  rollingWindowMs?: number;
  minimumRequestVolume?: number;
  halfOpenMaxConcurrentRequests?: number;
}

export interface CircuitBreakerExecuteOptions<TFallback = unknown> extends CircuitBreakerOptions {
  fallback?: (error: unknown) => Promise<TFallback> | TFallback;
}

export type ResolvedCircuitBreakerOptions = Required<CircuitBreakerOptions>;
