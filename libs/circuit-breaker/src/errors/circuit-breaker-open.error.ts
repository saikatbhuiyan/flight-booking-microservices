export class CircuitBreakerOpenError extends Error {
  constructor(
    readonly circuitName: string,
    readonly retryAt: Date,
  ) {
    super(`Circuit "${circuitName}" is open until ${retryAt.toISOString()}`);
    this.name = CircuitBreakerOpenError.name;
  }
}
