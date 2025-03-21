import * as amqplib from "amqplib";
import * as dotenv from "dotenv";

dotenv.config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";
const EXCHANGE_NAME = "services";
const LOGIN_EVENTS_QUEUE = "login_events";

let connection: any = null;
let channel: any = null;

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

export async function connectRabbitMQ() {
  try {
    console.log(`Attempting to connect to RabbitMQ at ${RABBITMQ_URL}...`);

    const connectionPromise = amqplib.connect(RABBITMQ_URL);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Connection timeout")), 5000);
    });

    connection = await Promise.race([connectionPromise, timeoutPromise]);
    channel = await connection.createChannel();

    await channel.assertQueue(LOGIN_EVENTS_QUEUE, { durable: true });
    await channel.bindQueue(LOGIN_EVENTS_QUEUE, EXCHANGE_NAME, "login");

    await channel.assertQueue("auth.responses", {
      durable: false,
      autoDelete: true,
    });
    await channel.bindQueue("auth.responses", EXCHANGE_NAME, "auth.responses");

    console.log("Connected to RabbitMQ successfully");

    connection.on("error", (err: Error) => {
      console.error("RabbitMQ connection error:", err);
      setTimeout(connectRabbitMQ, 5000);
    });

    connection.on("close", () => {
      console.log("RabbitMQ connection closed");
      setTimeout(connectRabbitMQ, 5000);
    });

    return { connection, channel };
  } catch (error) {
    console.error("Failed to connect to RabbitMQ:", error);
    setTimeout(connectRabbitMQ, 5000);
    return { connection: null, channel: null };
  }
}

export async function publishLoginEvent(event: LoginEvent) {
  try {
    if (!channel) {
      await connectRabbitMQ();

      if (!channel) {
        console.error(
          "Cannot publish login event: RabbitMQ connection not available"
        );
        return false;
      }
    }

    const result = channel.publish(
      EXCHANGE_NAME,
      "login",
      Buffer.from(JSON.stringify(event)),
      { persistent: true }
    );

    if (result) {
      console.log(
        "Published login event to RabbitMQ:",
        event.action,
        event.status
      );
      return true;
    } else {
      console.error("Failed to publish to RabbitMQ");
      return false;
    }
  } catch (error) {
    console.error("Failed to publish login event:", error);
    return false;
  }
}

export async function setupResponseQueue(
    queueName: string,
    callback: (message: any) => void
  ) {
    try {
      if (!channel) {
        await connectRabbitMQ();
        
        if (!channel) {
          console.error(`Cannot set up response queue ${queueName}: RabbitMQ connection not available`);
          setTimeout(() => setupResponseQueue(queueName, callback), 5000);
          return;
        }
      }
      
      await channel.assertQueue(queueName, { durable: false, autoDelete: true });
      await channel.bindQueue(queueName, EXCHANGE_NAME, queueName);
      
      await channel.consume(queueName, (msg: any) => {
        if (msg) {
          try {
            const message = JSON.parse(msg.content.toString());
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
      if (!channel) {
        await connectRabbitMQ();
        
        if (!channel) {
          console.error(`Cannot consume messages from ${queueName}: RabbitMQ connection not available`);
          setTimeout(() => consumeMessages(queueName, callback), 5000);
          return;
        }
      }
      
      await channel.assertQueue(queueName, { durable: true });
      await channel.bindQueue(queueName, EXCHANGE_NAME, queueName);
      
      await channel.consume(queueName, async (msg: any) => {
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
                  timestamp: new Date()
                });
              };
            }
            
            await callback(message, replyCallback);
            channel.ack(msg);
          } catch (error) {
            console.error(`Error processing message from ${queueName}:`, error);
            channel.nack(msg, false, false);
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
    message: any
  ) {
    try {
      if (!channel) {
        await connectRabbitMQ();
        
        if (!channel) {
          console.error(`Cannot publish message to ${routingKey}: RabbitMQ connection not available`);
          return false;
        }
      }
      
      const result = channel.publish(
        EXCHANGE_NAME,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        {
          persistent: true,
          correlationId: message.correlationId,
          replyTo: message.replyTo
        }
      );
      
      return result;
    } catch (error) {
      console.error(`Failed to publish message to ${routingKey}:`, error);
      return false;
    }
  }

export async function closeRabbitMQ() {
  try {
    if (channel) {
      await channel.close();
      channel = null;
    }
    if (connection) {
      await connection.close();
      connection = null;
    }
    console.log("RabbitMQ connection closed");
  } catch (error) {
    console.error("Error closing RabbitMQ connection:", error);
  }
}
