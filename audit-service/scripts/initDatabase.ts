import * as dotenv from "dotenv";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";

dotenv.config();

// Create a Prisma client instance
const prisma = new PrismaClient();

async function initDatabase() {
  try {
    console.log("Starting audit database initialization...");

    console.log("Pushing audit Prisma schema...");
    const env = { ...process.env };
    execSync("npx prisma db push", {
      stdio: "inherit",
      env,
    });

    console.log("audit database schema created successfully!");
  } catch (error) {
    console.error("Error initializing audit database:", error);
  } finally {
    await prisma.$disconnect();
  }
}

initDatabase()
  .then(() => {
    console.log("Database initialization completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
