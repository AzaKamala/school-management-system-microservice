import express from 'express';
import dotenv from 'dotenv';
import authRouter from './routes/authRouter';
import oauthRouter from './routes/oauthRouter';
import verifyTokenRouter from './routes/verifyTokenRouter';
import { connectRabbitMQ, consumeMessages, setupResponseQueue } from './utils/rabbitmq';
import { tenantServiceCircuitBreaker } from './utils/circuitBreaker';
import { messageHandlers, handleUnknownAction } from '../src/utils/messageHandlers';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

async function setupMessaging() {
  try {
    await connectRabbitMQ();
    
    await setupResponseQueue('auth.responses', (message) => {
      if (message.correlationId) {
        tenantServiceCircuitBreaker.handleResponse(
          message.correlationId,
          message.data,
          message.error
        );
      }
    });
    
    await consumeMessages("auth.requests", async (message, replyCallback) => {
      try {
        console.log("Received auth service request:", { action: message.action });
        
        const handler = messageHandlers[message.action] || handleUnknownAction;
        await handler(message, replyCallback);
      } catch (error) {
        console.error("Error processing auth request:", {
          error,
          action: message.action
        });
        
        if (replyCallback) {
          await replyCallback({
            error: "Internal processing error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    });
  } catch (error) {
    console.error("Failed to set up messaging:", error);
  }
}

setupMessaging();

app.use(express.json());
app.use('/auth', authRouter);
app.use('/auth/oauth', oauthRouter);
app.use('/', verifyTokenRouter);

app.listen(port, () => {
  console.log(`Auth service running at http://localhost:${port}`);
});