import express from "express";
import dotenv from "dotenv";
import auditRouter from "./routes/auditRouter";
import adminAuditRouter from "./routes/adminAuditRouter";
import { connectRabbitMQ, consumeMessages } from "./utils/rabbitmq";
import { initializeServiceMessaging } from "./utils/serviceMessaging";
import { startRetryProcessor } from "./utils/messageRetryQueue";
import { startWorker } from "./workers/auditLogWorker";
import { authenticateJWT } from "./middlewares/authMiddleware";
import { messageHandlers, handleUnknownAction } from "./utils/messageHandlers";

dotenv.config();

async function startServer() {
  try {
    const app = express();
    const port = process.env.PORT || 3003;

    await connectRabbitMQ();

    await initializeServiceMessaging();

    const retryProcessor = startRetryProcessor();

    await startWorker();

    await consumeMessages("audit.requests", async (message, replyCallback) => {
      try {
        console.log("Received service request", { action: message.action });

        const handler = messageHandlers[message.action] || handleUnknownAction;
        await handler(message, replyCallback);
      } catch (error) {
        console.error("Error processing audit request", {
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

    app.use("/", auditRouter);
    app.use("/admin", adminAuditRouter);

    app.listen(port, () => {
      console.log(`Audit service running at http://localhost:${port}`);
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
    console.error("Failed to start audit service", error);
    process.exit(1);
  }
}

startServer();
