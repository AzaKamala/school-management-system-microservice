import { ServiceMessage, publishMessage } from "./rabbitmq";

const retryQueue: Array<{
  routingKey: string;
  message: ServiceMessage;
  attempts: number;
  nextAttempt: number;
}> = [];

const MAX_ATTEMPTS = 5;
const INITIAL_RETRY_DELAY = 1000;

export function addToRetryQueue(
  routingKey: string,
  message: ServiceMessage
): void {
  retryQueue.push({
    routingKey,
    message,
    attempts: 0,
    nextAttempt: Date.now() + INITIAL_RETRY_DELAY,
  });

  console.log("Added message to retry queue", {
    routingKey,
    action: message.action,
    correlationId: message.correlationId,
  });
}

export function startRetryProcessor(intervalMs: number = 5000): NodeJS.Timeout {
  return setInterval(async () => {
    const now = Date.now();
    const itemsToRetry = retryQueue.filter((item) => item.nextAttempt <= now);

    for (const item of itemsToRetry) {
      try {
        const result = await publishMessage(item.routingKey, item.message);

        if (result) {
          const index = retryQueue.indexOf(item);
          if (index > -1) {
            retryQueue.splice(index, 1);
          }

          console.log("Successfully retried message", {
            routingKey: item.routingKey,
            action: item.message.action,
            attempts: item.attempts + 1,
          });
        } else {
          item.attempts++;

          if (item.attempts >= MAX_ATTEMPTS) {
            const index = retryQueue.indexOf(item);
            if (index > -1) {
              retryQueue.splice(index, 1);
            }

            console.error("Failed to retry message after max attempts", {
              routingKey: item.routingKey,
              action: item.message.action,
              attempts: item.attempts,
            });
          } else {
            const delay = INITIAL_RETRY_DELAY * Math.pow(2, item.attempts);
            item.nextAttempt = now + delay;

            console.log("Scheduled message for retry", {
              routingKey: item.routingKey,
              action: item.message.action,
              nextAttempt: new Date(item.nextAttempt).toISOString(),
              attempts: item.attempts,
            });
          }
        }
      } catch (error) {
        console.error("Error during message retry", {
          error,
          routingKey: item.routingKey,
          action: item.message.action,
        });

        item.attempts++;
        if (item.attempts >= MAX_ATTEMPTS) {
          const index = retryQueue.indexOf(item);
          if (index > -1) {
            retryQueue.splice(index, 1);
          }
        } else {
          const delay = INITIAL_RETRY_DELAY * Math.pow(2, item.attempts);
          item.nextAttempt = now + delay;
        }
      }
    }
  }, intervalMs);
}

export function getRetryQueueStats() {
  return {
    total: retryQueue.length,
    byRoutingKey: retryQueue.reduce((acc, item) => {
      acc[item.routingKey] = (acc[item.routingKey] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };
}
