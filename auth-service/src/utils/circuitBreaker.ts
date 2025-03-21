import { publishMessage } from "./rabbitmq";
import { v4 as uuidv4 } from "uuid";

enum CircuitState {
  CLOSED,
  OPEN,
  HALF_OPEN,
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private pendingRequests: Map<string, PendingRequest> = new Map();

  constructor(
    private readonly serviceName: string,
    private readonly failureThreshold: number = 3,
    private readonly resetTimeout: number = 10000,
    private readonly halfOpenSuccessThreshold: number = 2,
    private readonly requestTimeout: number = 5000
  ) {
    console.log(`Circuit breaker initialized for ${serviceName} service`);
  }

  async executeRequest(
    routingKey: string,
    message: any,
    timeout: number = this.requestTimeout
  ): Promise<any> {
    if (this.isOpen()) {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.toHalfOpen();
      } else {
        throw new Error(
          `Circuit for ${this.serviceName} is open - request rejected`
        );
      }
    }

    try {
      const correlationId = uuidv4();

      const responsePromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.pendingRequests.has(correlationId)) {
            this.pendingRequests.delete(correlationId);
            this.onFailure();
            reject(
              new Error(`Request to ${routingKey} timed out after ${timeout}ms`)
            );
          }
        }, timeout);

        this.pendingRequests.set(correlationId, { resolve, reject, timer });
      });

      const messageWithMetadata = {
        ...message,
        correlationId,
        replyTo: `${this.serviceName}.responses`,
        timestamp: new Date(),
      };

      const published = await publishMessage(routingKey, messageWithMetadata);

      if (!published) {
        this.onFailure();
        throw new Error(`Failed to publish message to ${routingKey}`);
      }

      const response = await responsePromise;
      this.onSuccess();
      return response;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  handleResponse(correlationId: string, response: any, error?: any): void {
    if (!this.pendingRequests.has(correlationId)) {
      console.warn(`Received response for unknown request: ${correlationId}`);
      return;
    }

    const request = this.pendingRequests.get(correlationId)!;
    clearTimeout(request.timer);
    this.pendingRequests.delete(correlationId);

    if (error) {
      this.onFailure();
      request.reject(new Error(error));
    } else {
      this.onSuccess();
      request.resolve(response);
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;

      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.toClose();
      }
    }
  }

  private onFailure(): void {
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.CLOSED) {
      this.failureCount++;

      if (this.failureCount >= this.failureThreshold) {
        this.toOpen();
      }
    } else if (this.state === CircuitState.HALF_OPEN) {
      this.toOpen();
    }
  }

  private toClose(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    console.log(`Circuit breaker for ${this.serviceName} state: CLOSED`);
  }

  private toOpen(): void {
    this.state = CircuitState.OPEN;
    this.successCount = 0;
    console.log(`Circuit breaker for ${this.serviceName} state: OPEN`);
  }

  private toHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.failureCount = 0;
    this.successCount = 0;
    console.log(`Circuit breaker for ${this.serviceName} state: HALF-OPEN`);
  }

  private isOpen(): boolean {
    return this.state === CircuitState.OPEN;
  }

  getState(): string {
    switch (this.state) {
      case CircuitState.CLOSED:
        return "CLOSED";
      case CircuitState.OPEN:
        return "OPEN";
      case CircuitState.HALF_OPEN:
        return "HALF-OPEN";
      default:
        return "UNKNOWN";
    }
  }

  reset(): void {
    this.toClose();
  }
}

export const tenantServiceCircuitBreaker = new CircuitBreaker(
  "auth",
  3,
  10000,
  2,
  3000
);
