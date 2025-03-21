import {
  getAuditLogs,
  getAdminAuditLogs,
  getAuditLogById,
  getFailedLoginAttempts,
} from "../queries/auditLogQueries";

export type MessageHandler = (
  message: any,
  replyCallback?: (response: any) => Promise<void>
) => Promise<void>;

export async function handleGetAuditLogs(
  message: any,
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  try {
    const {
      tenantId,
      userId,
      status,
      action,
      startDate,
      endDate,
      limit,
      offset,
    } = message.data;

    if (!tenantId) {
      if (replyCallback) {
        await replyCallback({
          error: "Tenant ID is required",
        });
      }
      return;
    }

    const startDateObj = startDate ? new Date(startDate) : undefined;
    const endDateObj = endDate ? new Date(endDate) : undefined;

    const result = await getAuditLogs(tenantId, {
      userId,
      status,
      action,
      startDate: startDateObj,
      endDate: endDateObj,
      limit: limit || 100,
      offset: offset || 0,
    });

    if (replyCallback) {
      await replyCallback(result);
    }
  } catch (error) {
    console.error("Error handling getAuditLogs request:", error);
    if (replyCallback) {
      await replyCallback({
        error: "Failed to retrieve audit logs",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function handleGetAdminAuditLogs(
  message: any,
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  try {
    const {
      tenantId,
      userId,
      status,
      action,
      startDate,
      endDate,
      limit,
      offset,
    } = message.data;

    const startDateObj = startDate ? new Date(startDate) : undefined;
    const endDateObj = endDate ? new Date(endDate) : undefined;

    const result = await getAdminAuditLogs({
      tenantId,
      userId,
      status,
      action,
      startDate: startDateObj,
      endDate: endDateObj,
      limit: limit || 100,
      offset: offset || 0,
    });

    if (replyCallback) {
      await replyCallback(result);
    }
  } catch (error) {
    console.error("Error handling getAdminAuditLogs request:", error);
    if (replyCallback) {
      await replyCallback({
        error: "Failed to retrieve admin audit logs",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function handleGetAuditLogById(
  message: any,
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  try {
    const { id } = message.data;

    if (!id) {
      if (replyCallback) {
        await replyCallback({
          error: "Audit log ID is required",
        });
      }
      return;
    }

    const auditLog = await getAuditLogById(id);

    if (!auditLog) {
      if (replyCallback) {
        await replyCallback({
          error: "Audit log not found",
        });
      }
      return;
    }

    if (replyCallback) {
      await replyCallback({ auditLog });
    }
  } catch (error) {
    console.error("Error handling getAuditLogById request:", error);
    if (replyCallback) {
      await replyCallback({
        error: "Failed to retrieve audit log",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function handleGetFailedLoginAttempts(
  message: any,
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  try {
    const { email, tenantId, period } = message.data;

    if (!email) {
      if (replyCallback) {
        await replyCallback({
          error: "Email is required",
        });
      }
      return;
    }

    const lookbackPeriod = period ? parseInt(period) : 15;
    const startDate = new Date(Date.now() - lookbackPeriod * 60 * 1000);

    const count = await getFailedLoginAttempts(tenantId, email, startDate);

    if (replyCallback) {
      await replyCallback({ count });
    }
  } catch (error) {
    console.error("Error handling getFailedLoginAttempts request:", error);
    if (replyCallback) {
      await replyCallback({
        error: "Failed to retrieve failed login attempts",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function handleUnknownAction(
  message: any,
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  console.warn("Received unknown action:", message.action);
  if (replyCallback) {
    await replyCallback({
      error: "Unknown action",
      action: message.action,
    });
  }
}

export const messageHandlers: Record<string, MessageHandler> = {
  "get-audit-logs": handleGetAuditLogs,
  "get-admin-audit-logs": handleGetAdminAuditLogs,
  "get-audit-log-by-id": handleGetAuditLogById,
  "get-failed-login-attempts": handleGetFailedLoginAttempts,
};
