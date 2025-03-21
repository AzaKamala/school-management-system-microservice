import { PrismaClient } from "@prisma/client";
import { LoginEvent } from "../utils/rabbitmq";
import AuditLogDTO from "../DTOs/auditLogDTO";

const prisma = new PrismaClient();

export async function createAuditLog(event: LoginEvent) {
  try {
    console.log(`Creating audit log for ${event.email}`);

    return await prisma.auditLog.create({
      data: {
        userId: event.userId,
        email: event.email,
        tenantId: event.tenantId,
        action: event.action,
        status: event.status,
        ip: event.ip,
        userAgent: event.userAgent,
        metadata: event.metadata || {},
      },
    });
  } catch (error) {
    console.error(`Error creating audit log:`, error);
    throw error;
  }
}

export async function getAuditLogs(
  tenantId: string,
  options: {
    userId?: string;
    status?: string;
    action?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  } = {}
) {
  try {
    const where: any = { tenantId };

    if (options.userId) where.userId = options.userId;
    if (options.status) where.status = options.status;
    if (options.action) where.action = options.action;

    if (options.startDate && options.endDate) {
      where.createdAt = {
        gte: options.startDate,
        lte: options.endDate,
      };
    } else if (options.startDate) {
      where.createdAt = { gte: options.startDate };
    } else if (options.endDate) {
      where.createdAt = { lte: options.endDate };
    }

    const totalCount = await prisma.auditLog.count({ where });

    const auditLogs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: options.limit || 100,
      skip: options.offset || 0,
    });

    return {
      data: auditLogs.map((log: any) => AuditLogDTO.fromObject(log)),
      pagination: {
        total: totalCount,
        limit: options.limit || 100,
        offset: options.offset || 0,
      },
    };
  } catch (error) {
    console.error(`Error fetching audit logs for tenant ${tenantId}:`, error);
    throw error;
  }
}

export async function getAdminAuditLogs(
  options: {
    tenantId?: string;
    userId?: string;
    status?: string;
    action?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  } = {}
) {
  try {
    const where: any = {};

    if (options.tenantId === null) {
      where.tenantId = null;
    } else if (options.tenantId) {
      where.tenantId = options.tenantId;
    }

    if (options.userId) where.userId = options.userId;
    if (options.status) where.status = options.status;
    if (options.action) where.action = options.action;

    if (options.startDate && options.endDate) {
      where.createdAt = {
        gte: options.startDate,
        lte: options.endDate,
      };
    } else if (options.startDate) {
      where.createdAt = { gte: options.startDate };
    } else if (options.endDate) {
      where.createdAt = { lte: options.endDate };
    }

    const totalCount = await prisma.auditLog.count({ where });

    const auditLogs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: options.limit || 100,
      skip: options.offset || 0,
    });

    return {
      data: auditLogs.map((log: any) => AuditLogDTO.fromObject(log)),
      pagination: {
        total: totalCount,
        limit: options.limit || 100,
        offset: options.offset || 0,
      },
    };
  } catch (error) {
    console.error(`Error fetching admin audit logs:`, error);
    throw error;
  }
}

export async function getAuditLogById(id: string) {
  try {
    const auditLog = await prisma.auditLog.findUnique({
      where: { id },
    });

    if (!auditLog) {
      return null;
    }

    return AuditLogDTO.fromObject(auditLog);
  } catch (error) {
    console.error(`Error fetching audit log by ID ${id}:`, error);
    throw error;
  }
}

export async function getFailedLoginAttempts(
  tenantId: string | null,
  email: string,
  startDate: Date
) {
  try {
    const where: any = {
      email,
      action: "login",
      status: "failure",
      createdAt: {
        gte: startDate,
      },
    };

    if (tenantId !== undefined) {
      where.tenantId = tenantId;
    }

    const count = await prisma.auditLog.count({ where });
    return count;
  } catch (error) {
    console.error(`Error fetching failed login attempts:`, error);
    throw error;
  }
}
