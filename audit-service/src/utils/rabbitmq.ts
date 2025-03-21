import * as amqplib from "amqplib";
import { Channel, ConsumeMessage } from "amqplib";
import * as dotenv from "dotenv";
import { tenantServiceCircuitBreaker } from "./circuitBreaker";

dotenv.config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";
const EXCHANGE_NAME = "services";
const LOGIN_EVENTS_QUEUE = "login_events";

export interface ServiceMessage {
  action: string;
  data: any;
  correlationId?: string;
  replyTo?: string;
  timestamp: Date;
}

export interface LoginEvent {
  userId?: string;
  email: string;
  tenantId?: string;
  action: string;
  status: string;
  ip: string;
  userAgent: string;
  timestamp: Date;
  metadata?: any;
}

const connectionState = {
  connection: null as any,
  channel: null as Channel | null,
  isConnecting: false,
  isConnected: false,
  reconnectTimer: null as NodeJS.Timeout | null,
};

export async function connectRabbitMQ(): Promise<{
  connection: any | null;
  channel: Channel | null;
}> {
  if (connectionState.isConnecting) {
    return { connection: null, channel: null };
  }

  if (connectionState.isConnected && connectionState.channel) {
    return {
      connection: connectionState.connection,
      channel: connectionState.channel,
    };
  }

  connectionState.isConnecting = true;

  try {
    console.log(`Attempting to connect to RabbitMQ at ${RABBITMQ_URL}...`);

    if (connectionState.connection) {
      try {
        if (connectionState.channel) await connectionState.channel.close();
        await connectionState.connection.close();
      } catch (e) {
        console.error("Error closing existing connections", e);
      }
    }

    connectionState.connection = null;
    connectionState.channel = null;
    connectionState.isConnected = false;

    const connection = await amqplib.connect(RABBITMQ_URL);

    connection.on("error", (err) => {
      console.error("RabbitMQ connection error:", err);
      connectionState.isConnected = false;
      scheduleReconnect();
    });

    connection.on("close", () => {
      console.log("RabbitMQ connection closed");
      connectionState.isConnected = false;
      scheduleReconnect();
    });

    const channel = await connection.createChannel();

    channel.on("error", (err) => {
      console.error("RabbitMQ channel error:", err);
      connectionState.channel = null;
    });

    channel.on("close", () => {
      console.log("RabbitMQ channel closed");
      connectionState.channel = null;
    });

    connectionState.connection = connection;
    connectionState.channel = channel;
    connectionState.isConnected = true;
    connectionState.isConnecting = false;

    await channel.assertExchange(EXCHANGE_NAME, "direct", { durable: true });

    await channel.assertQueue(LOGIN_EVENTS_QUEUE, { durable: true });
    await channel.bindQueue(LOGIN_EVENTS_QUEUE, EXCHANGE_NAME, "login");

    await channel.assertQueue("audit.requests", { durable: true });
    await channel.bindQueue("audit.requests", EXCHANGE_NAME, "audit.requests");

    await channel.assertQueue("audit.responses", {
      durable: false,
      autoDelete: true,
    });
    await channel.bindQueue(
      "audit.responses",
      EXCHANGE_NAME,
      "audit.responses"
    );

    console.log("Connected to RabbitMQ successfully");

    return { connection, channel };
  } catch (error) {
    console.error("Failed to connect to RabbitMQ:", error);
    connectionState.isConnected = false;
    connectionState.isConnecting = false;
    scheduleReconnect();
    return { connection: null, channel: null };
  }
}

function scheduleReconnect() {
  if (!connectionState.reconnectTimer) {
    connectionState.reconnectTimer = setTimeout(() => {
      connectionState.reconnectTimer = null;
      connectionState.isConnecting = false;
      connectRabbitMQ();
    }, 5000);
  }
}

async function getChannel(): Promise<Channel | null> {
  if (connectionState.channel) return connectionState.channel;

  const { channel } = await connectRabbitMQ();
  return channel;
}

export async function consumeLoginEvents(
  callback: (event: LoginEvent) => Promise<void>
) {
  try {
    const channel = await getChannel();
    if (!channel) {
      console.error(
        "Cannot consume login events: RabbitMQ connection not available"
      );
      setTimeout(() => consumeLoginEvents(callback), 5000);
      return;
    }

    await channel.consume(
      LOGIN_EVENTS_QUEUE,
      async (msg: ConsumeMessage | null) => {
        if (msg) {
          try {
            const event = JSON.parse(msg.content.toString()) as LoginEvent;
            await callback(event);
            channel.ack(msg);
            console.log(`Processed login event for ${event.email}`);
          } catch (error) {
            console.error("Error processing login event:", error);
            channel.nack(
              msg,
              false,
              error instanceof Error && error.message.includes("temporary")
            );
          }
        }
      }
    );

    console.log("Consuming login events from RabbitMQ");
  } catch (error) {
    console.error("Failed to set up login event consumption:", error);
    setTimeout(() => consumeLoginEvents(callback), 5000);
  }
}

export async function setupResponseQueue(
  queueName: string,
  callback: (message: any) => void
) {
  try {
    const channel = await getChannel();
    if (!channel) {
      console.error(
        `Cannot set up response queue ${queueName}: RabbitMQ connection not available`
      );
      setTimeout(() => setupResponseQueue(queueName, callback), 5000);
      return;
    }

    await channel.assertQueue(queueName, {
      durable: false,
      autoDelete: true,
    });
    await channel.bindQueue(queueName, EXCHANGE_NAME, queueName);

    await channel.consume(queueName, (msg: ConsumeMessage | null) => {
      if (msg) {
        try {
          const message = JSON.parse(msg.content.toString());

          if (message.correlationId) {
            tenantServiceCircuitBreaker.handleResponse(
              message.correlationId,
              message.data,
              message.error
            );
          }

          callback(message);
          channel.ack(msg);
        } catch (error) {
          console.error(`Error processing message from ${queueName}:`, error);
          channel.nack(msg, false, false);
        }
      }
    });

    console.log(`Response queue ${queueName} set up successfully`);
  } catch (error) {
    console.error(`Failed to set up response queue ${queueName}:`, error);
    setTimeout(() => setupResponseQueue(queueName, callback), 5000);
  }
}

export async function consumeMessages(
  queueName: string,
  callback: (
    message: any,
    replyCallback?: (response: any) => Promise<void>
  ) => Promise<void>
) {
  try {
    const channel = await getChannel();
    if (!channel) {
      console.error(
        `Cannot consume messages from ${queueName}: RabbitMQ connection not available`
      );
      setTimeout(() => consumeMessages(queueName, callback), 5000);
      return;
    }

    await channel.assertQueue(queueName, { durable: true });
    await channel.bindQueue(queueName, EXCHANGE_NAME, queueName);

    await channel.consume(queueName, async (msg: ConsumeMessage | null) => {
      if (msg) {
        try {
          const message = JSON.parse(msg.content.toString());

          let replyCallback;
          if (msg.properties.replyTo && msg.properties.correlationId) {
            replyCallback = async (response: any) => {
              await publishMessage(msg.properties.replyTo, {
                action: "reply",
                data: response,
                correlationId: msg.properties.correlationId,
                timestamp: new Date(),
              });
            };
          }

          await callback(message, replyCallback);
          channel.ack(msg);
          console.log(`Processed message from ${queueName}:`, {
            action: message.action,
          });
        } catch (error) {
          console.error(`Error processing message from ${queueName}:`, error);
          const requeue =
            error instanceof Error &&
            !error.message.includes("Validation Error");
          channel.nack(msg, false, requeue);
        }
      }
    });

    console.log(`Consuming messages from ${queueName}`);
  } catch (error) {
    console.error(`Failed to set up consumption from ${queueName}:`, error);
    setTimeout(() => consumeMessages(queueName, callback), 5000);
  }
}

export async function publishMessage(
  routingKey: string,
  message: ServiceMessage
) {
  try {
    const channel = await getChannel();
    if (!channel) {
      console.error(
        `Cannot publish message to ${routingKey}: RabbitMQ connection not available`
      );
      return false;
    }

    const result = channel.publish(
      EXCHANGE_NAME,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      {
        persistent: true,
        correlationId: message.correlationId,
        replyTo: message.replyTo,
      }
    );

    if (result) {
      console.log(`Published message to ${routingKey}:`, {
        action: message.action,
      });
      return true;
    } else {
      console.error(`Failed to publish message to ${routingKey}`);
      return false;
    }
  } catch (error) {
    console.error(`Failed to publish message to ${routingKey}:`, error);
    return false;
  }
}

export async function closeRabbitMQ() {
  try {
    if (connectionState.reconnectTimer) {
      clearTimeout(connectionState.reconnectTimer);
      connectionState.reconnectTimer = null;
    }

    if (connectionState.channel) {
      await connectionState.channel.close();
      connectionState.channel = null;
    }

    if (connectionState.connection) {
      await connectionState.connection.close();
      connectionState.connection = null;
    }

    connectionState.isConnected = false;
    connectionState.isConnecting = false;

    console.log("RabbitMQ connection closed");
  } catch (error) {
    console.error("Error closing RabbitMQ connection:", error);
  }
}
