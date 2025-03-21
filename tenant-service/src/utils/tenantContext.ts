import { PrismaClient as AdminPrismaClient } from "@prisma/admin-client";
import { PrismaClient as TenantPrismaClient } from "@prisma/tenant-client";
import { execSync } from "child_process";
import { getTenantById } from "../queries/tenantQueries";

const tenantClients: Record<string, TenantPrismaClient> = {};

const adminPrisma = new AdminPrismaClient();

export async function getTenantPrismaClient(
  tenantId: string
): Promise<TenantPrismaClient> {
  const tenant = await getTenantById(tenantId);

  if (!tenant) {
    throw new Error(`Tenant with ID ${tenantId} not found`);
  }

  if (!tenant.active) {
    throw new Error(`Tenant ${tenant.name} is not active`);
  }

  if (tenantClients[tenant.id]) {
    return tenantClients[tenant.id];
  }

  const dbUrl = `${process.env.DATABASE_URL_PREFIX}${tenant.databaseName}`;
  const tenantPrisma = new TenantPrismaClient({
    datasources: {
      db: {
        url: dbUrl,
      },
    },
  });

  tenantClients[tenant.id] = tenantPrisma;

  return tenantPrisma;
}

export async function createTenantDatabase(
  databaseName: string
): Promise<void> {
  console.log(`Creating database for tenant: ${databaseName}`);

  try {
    const adminDbUrl = process.env.DATABASE_URL?.replace(
      /\/[^/]+$/,
      "/postgres"
    );

    const tempAdminPrisma = new AdminPrismaClient({
      datasources: { db: { url: adminDbUrl } },
    });

    const dbExists = await tempAdminPrisma.$queryRaw`
      SELECT 1 FROM pg_database WHERE datname = ${databaseName}
    `;

    if (!Array.isArray(dbExists) || dbExists.length === 0) {
      await tempAdminPrisma.$executeRawUnsafe(
        `CREATE DATABASE "${databaseName}"`
      );
    }

    await tempAdminPrisma.$disconnect();

    const dbUrl = `${process.env.DATABASE_URL_PREFIX}${databaseName}`;
    const env = { ...process.env, TENANT_DATABASE_URL: dbUrl };

    console.log(
      `Pushing schema to database ${databaseName} using URL: ${dbUrl}`
    );
    execSync(`npx prisma db push --schema="./prisma/tenant.prisma"`, {
      stdio: "inherit",
      env: env,
    });

    console.log(
      `Successfully initialized database for tenant: ${databaseName}`
    );
  } catch (error) {
    console.error(`Error initializing tenant database ${databaseName}:`, error);
    throw error;
  }
}

export { adminPrisma };
