export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number; // Consecutive failures to trip circuit (default: 3)
  cooldownPeriodMs?: number; // Milliseconds to wait before half-open probe (default: 30000)
  halfOpenSuccessThreshold?: number; // Successes in half-open to close (default: 1)
}

export class CircuitBreaker {
  readonly name: string;
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private lastStateChangeTime = Date.now();
  private readonly failureThreshold: number;
  private readonly cooldownPeriodMs: number;
  private readonly halfOpenSuccessThreshold: number;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold || 3;
    this.cooldownPeriodMs = options.cooldownPeriodMs || 30000;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold || 1;
  }

  public getState(): CircuitState {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.cooldownPeriodMs) {
        this.transitionTo('HALF_OPEN');
      }
    }
    return this.state;
  }

  private transitionTo(newState: CircuitState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChangeTime = Date.now();
    if (newState === 'HALF_OPEN') {
      this.successCount = 0;
    } else if (newState === 'CLOSED') {
      this.failureCount = 0;
      this.successCount = 0;
    }
    console.log(`[CircuitBreaker:${this.name}] Transitioned from ${oldState} -> ${newState}`);
  }

  public recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.transitionTo('CLOSED');
      }
    } else if (this.state === 'CLOSED') {
      this.failureCount = 0;
    }
  }

  public reset(): void {
    this.transitionTo('CLOSED');
  }

  public recordFailure(error?: any): void {
    this.lastFailureTime = Date.now();
    this.failureCount++;

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  public async execute<T>(
    operation: () => Promise<T>,
    fallback?: (reason: string) => Promise<T>
  ): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      const reason = `Circuit breaker for ${this.name} is OPEN (tripped after consecutive failures). Cooldown active.`;
      if (fallback) {
        return fallback(reason);
      }
      throw new Error(reason);
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (err: any) {
      this.recordFailure(err);
      if (fallback) {
        return fallback(err.message || 'Operation failed under circuit breaker');
      }
      throw err;
    }
  }

  public getMetrics() {
    return {
      name: this.name,
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime > 0 ? new Date(this.lastFailureTime).toISOString() : null,
      cooldownPeriodMs: this.cooldownPeriodMs,
      failureThreshold: this.failureThreshold,
    };
  }
}

export const googlePlacesCircuitBreaker = new CircuitBreaker({
  name: 'GooglePlacesAPI',
  failureThreshold: 3,
  cooldownPeriodMs: 25000,
});

export const osmCircuitBreaker = new CircuitBreaker({
  name: 'OpenStreetMapAPI',
  failureThreshold: 3,
  cooldownPeriodMs: 20000,
});
