import * as amqplib from "amqplib";
import { Channel, ConsumeMessage } from "amqplib";
import * as dotenv from "dotenv";
import { authServiceCircuitBreaker } from "./circuitBreaker";

dotenv.config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";
const EXCHANGE_NAME = "services";
const QUEUE_NAME = "login_events";

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
    if (connectionState.connection) {
      try {
        if (connectionState.channel) await connectionState.channel.close();
        await connectionState.connection.close();
      } catch (e) {}
    }

    connectionState.connection = null;
    connectionState.channel = null;
    connectionState.isConnected = false;

    const connection = await amqplib.connect(RABBITMQ_URL);

    connection.on("error", () => {
      connectionState.isConnected = false;
      scheduleReconnect();
    });

    connection.on("close", () => {
      connectionState.isConnected = false;
      scheduleReconnect();
    });

    const channel = await connection.createChannel();

    channel.on("error", () => {
      connectionState.channel = null;
    });

    channel.on("close", () => {
      connectionState.channel = null;
    });

    connectionState.connection = connection;
    connectionState.channel = channel;
    connectionState.isConnected = true;
    connectionState.isConnecting = false;

    await channel.assertExchange(EXCHANGE_NAME, "direct", { durable: true });
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, "login");

    return { connection, channel };
  } catch (error) {
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

export async function publishLoginEvent(event: LoginEvent) {
  try {
    const channel = await getChannel();
    if (!channel) return false;

    const result = channel.publish(
      EXCHANGE_NAME,
      "login",
      Buffer.from(JSON.stringify(event)),
      { persistent: true }
    );

    return result;
  } catch (error) {
    return false;
  }
}

export async function setupResponseQueue(
  queueName: string,
  callback: (message: any) => void
) {
  try {
    const channel = await getChannel();
    if (!channel) {
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
            authServiceCircuitBreaker.handleResponse(
              message.correlationId,
              message.data,
              message.error
            );
          }

          callback(message);
          channel.ack(msg);
        } catch (error) {
          channel.nack(msg, false, false);
        }
      }
    });
  } catch (error) {
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
        } catch (error) {
          channel.nack(msg, false, false);
        }
      }
    });
  } catch (error) {
    setTimeout(() => consumeMessages(queueName, callback), 5000);
  }
}

export async function publishMessage(routingKey: string, message: any) {
  try {
    const channel = await getChannel();
    if (!channel) return false;

    return channel.publish(
      EXCHANGE_NAME,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      {
        persistent: true,
        correlationId: message.correlationId,
        replyTo: message.replyTo,
      }
    );
  } catch (error) {
    return false;
  }
}

export async function closeRabbitMQ() {
  if (connectionState.reconnectTimer) {
    clearTimeout(connectionState.reconnectTimer);
    connectionState.reconnectTimer = null;
  }

  try {
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
  } catch (error) {}
}
