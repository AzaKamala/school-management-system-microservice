import express from "express";
import dotenv from "dotenv";
import {
  connectRabbitMQ,
  consumeMessages,
  setupResponseQueue,
} from "./utils/rabbitmq";
import { initializeServiceMessaging } from "./utils/serviceMessaging";
import { startRetryProcessor } from "./utils/messageRetryQueue";
import adminUserRouter from "./routes/adminUserRouter";
import tenantRouter from "./routes/tenantRouter";
import userRouter from "./routes/userRouter";
import { authenticateJWT } from "./middlewares/authMiddleware";
import { messageHandlers, handleUnknownAction } from "../src/utils/messageHandlers";

dotenv.config();

async function startServer() {
  try {
    const app = express();
    const port = process.env.PORT || 3002;

    await connectRabbitMQ();

    await setupResponseQueue("tenant.responses", (message) => {
      console.log("Received response:", {
        correlationId: message.correlationId,
        action: message.action,
      });
    });

    await initializeServiceMessaging();

    const retryProcessor = startRetryProcessor();

    await consumeMessages("tenant.requests", async (message, replyCallback) => {
      try {
        console.log("Received service request", { action: message.action });
        
        const handler = messageHandlers[message.action] || handleUnknownAction;
        
        await handler(message, replyCallback);
      } catch (error) {
        console.error("Error processing tenant request", {
          error,
          action: message.action,
        });

        if (replyCallback) {
          await replyCallback({
            error: "Internal processing error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });

    app.use(express.json());
    app.use(authenticateJWT);
    app.use("/admin-user", adminUserRouter);
    app.use("/tenant", tenantRouter);
    app.use("/tenant/:tenantId/user", userRouter);

    app.listen(port, () => {
      console.log(`Tenant service running at http://localhost:${port}`);
    });

    process.on("SIGTERM", async () => {
      console.log("SIGTERM received, shutting down gracefully");
      clearInterval(retryProcessor);
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      console.log("SIGINT received, shutting down gracefully");
      clearInterval(retryProcessor);
      process.exit(0);
    });
  } catch (error) {
    console.error("Failed to start tenant service", { error });
    process.exit(1);
  }
}

startServer();