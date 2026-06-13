import { CircuitBreakerOpenError } from '../errors';
import { CircuitBreakerState } from '../interfaces';
import { CircuitBreakerService } from './circuit-breaker.service';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(() => {
    service = new CircuitBreakerService({
      failureThreshold: 2,
      minimumRequestVolume: 2,
      successThreshold: 1,
      openStateTimeoutMs: 5,
    });
  });

  it('opens the circuit after the failure threshold is reached', async () => {
    await expect(service.execute('payments', () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    await expect(service.execute('payments', () => Promise.reject(new Error('down')))).rejects.toThrow('down');

    const snapshot = service.getSnapshot('payments');

    expect(snapshot?.state).toBe(CircuitBreakerState.OPEN);
  });

  it('rejects calls while the circuit is open', async () => {
    await expect(service.execute('payments', () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    await expect(service.execute('payments', () => Promise.reject(new Error('down')))).rejects.toThrow('down');

    await expect(service.execute('payments', () => 'ok')).rejects.toBeInstanceOf(CircuitBreakerOpenError);
  });

  it('uses fallback when the circuit is open', async () => {
    await expect(service.execute('payments', () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    await expect(service.execute('payments', () => Promise.reject(new Error('down')))).rejects.toThrow('down');

    await expect(service.execute('payments', () => 'ok', { fallback: () => 'cached' })).resolves.toBe('cached');
  });

  it('moves to half open and closes after a successful probe', async () => {
    await expect(service.execute('payments', () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    await expect(service.execute('payments', () => Promise.reject(new Error('down')))).rejects.toThrow('down');

    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(service.execute('payments', () => 'ok')).resolves.toBe('ok');
    expect(service.getSnapshot('payments')?.state).toBe(CircuitBreakerState.CLOSED);
  });
});
