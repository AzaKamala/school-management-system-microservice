import { getTenantById } from "../queries/tenantQueries";
import TenantDTO from "../DTOs/tenantDTO";
import { getTenantUserByEmail, getTenantUserById, getUserPermissions, getUserRoles } from "../queries/userQueries";
import TenantUserDTO from "../DTOs/userDTO";
import bcrypt from "bcryptjs";
import { getAdminUserByEmail, getAdminUserById } from "../queries/adminUserQueries";
import { adminPrisma } from "../utils/tenantContext";
import AdminUserDTO from "../DTOs/adminUserDTO";

export type MessageHandler = (
  message: any, 
  replyCallback?: (response: any) => Promise<void>
) => Promise<void>;

export async function handleGetTenant(
  message: any, 
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  const tenant = await getTenantById(message.data.id);
  
  if (!tenant) {
    if (replyCallback) {
      await replyCallback({
        error: "Tenant not found",
        tenantId: message.data.id,
      });
    }
  } else if (replyCallback) {
    await replyCallback({ tenant: TenantDTO.fromObject(tenant) });
  }
}

export async function handleVerifyUser(
  message: any, 
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  if (!message.data.userId || !message.data.tenantId) {
    if (replyCallback) {
      await replyCallback({
        error: "Missing required parameters",
        requiredParams: ["userId", "tenantId"],
      });
    }
    return;
  }

  try {
    const user = await getTenantUserById(
      message.data.tenantId,
      message.data.userId
    );

    if (!user || !user.active) {
      if (replyCallback) {
        await replyCallback({ verified: false });
      }
    } else {
      const roles = await getUserRoles(
        message.data.tenantId,
        message.data.userId
      );
      const permissions = await getUserPermissions(
        message.data.tenantId,
        message.data.userId
      );

      if (replyCallback) {
        await replyCallback({
          verified: true,
          user: TenantUserDTO.fromObject(user),
          roles: roles.map((r) => r.name),
          permissions,
        });
      }
    }
  } catch (error) {
    if (replyCallback) {
      await replyCallback({
        error: "Failed to verify user",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function handleGetUserPermissions(
  message: any, 
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  if (!message.data.userId || !message.data.tenantId) {
    if (replyCallback) {
      await replyCallback({
        error: "Missing required parameters",
        requiredParams: ["userId", "tenantId"],
      });
    }
    return;
  }

  try {
    const permissions = await getUserPermissions(
      message.data.tenantId,
      message.data.userId
    );
    if (replyCallback) {
      await replyCallback({ permissions });
    }
  } catch (error) {
    if (replyCallback) {
      await replyCallback({
        error: "Failed to get user permissions",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function handleVerifyAdminUser(
  message: any, 
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  try {
    const { email, password } = message.data;
    const adminUser = await getAdminUserByEmail(email);

    if (!adminUser || !adminUser.active) {
      if (replyCallback) {
        await replyCallback({ verified: false });
      }
      return;
    }

    const isPasswordValid = await bcrypt.compare(
      password,
      adminUser.password
    );

    if (!isPasswordValid) {
      if (replyCallback) {
        await replyCallback({ verified: false });
      }
      return;
    }

    const userRole = adminUser.assignedRole;
    const roles = userRole ? [userRole.name] : [];

    const permissions = userRole
      ? await adminPrisma.rolePermission
          .findMany({
            where: { roleId: userRole.id },
            include: { permission: true },
          })
          .then((rps) => rps.map((rp) => rp.permission.name))
      : [];

    if (replyCallback) {
      await replyCallback({
        verified: true,
        user: AdminUserDTO.fromObject(adminUser),
        roles,
        permissions,
      });
    }
  } catch (error) {
    if (replyCallback) {
      await replyCallback({
        error: "Failed to verify admin user",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function handleVerifyTenantUser(
  message: any, 
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  try {
    const { email, password, tenantId } = message.data;

    console.log("Verifying tenant user", email, tenantId);
    
    if (!email || !password || !tenantId) {
      if (replyCallback) {
        await replyCallback({
          verified: false,
          error: "Missing required parameters"
        });
      }
      return;
    }
    
    const user = await getTenantUserByEmail(tenantId, email);
    
    if (!user || !user.active) {
      if (replyCallback) {
        await replyCallback({ verified: false });
      }
      return;
    }
    
    if (!user.password) {
      if (replyCallback) {
        await replyCallback({ verified: false });
      }
      return;
    }
    
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      if (replyCallback) {
        await replyCallback({ verified: false });
      }
      return;
    }
    
    const roles = await getUserRoles(tenantId, user.id);
    const permissions = await getUserPermissions(tenantId, user.id);
    
    if (replyCallback) {
      await replyCallback({
        verified: true,
        user: TenantUserDTO.fromObject(user),
        roles: roles.map(r => r.name),
        permissions
      });
    }
  } catch (error) {
    console.error("Error verifying tenant user:", error);
    if (replyCallback) {
      await replyCallback({
        verified: false,
        error: "Failed to verify tenant user",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export async function handleGetAdminUser(
  message: any, 
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  try {
    const { userId } = message.data;
    
    if (!userId) {
      if (replyCallback) {
        await replyCallback({
          error: "User ID is required"
        });
      }
      return;
    }
    
    const adminUser = await getAdminUserById(userId);
    
    if (!adminUser || !adminUser.active) {
      if (replyCallback) {
        await replyCallback({
          error: "Admin user not found or inactive"
        });
      }
      return;
    }
    
    const userRole = adminUser.assignedRole;
    const roles = userRole ? [userRole.name] : [];
    
    const permissions = userRole
      ? await adminPrisma.rolePermission
          .findMany({
            where: { roleId: userRole.id },
            include: { permission: true },
          })
          .then((rps) => rps.map((rp) => rp.permission.name))
      : [];
    
    if (replyCallback) {
      await replyCallback({
        user: AdminUserDTO.fromObject(adminUser),
        roles,
        permissions
      });
    }
  } catch (error) {
    console.error("Error getting admin user:", error);
    if (replyCallback) {
      await replyCallback({
        error: "Failed to get admin user",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export async function handleGetTenantUser(
  message: any, 
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  try {
    const { userId, tenantId } = message.data;
    
    if (!userId || !tenantId) {
      if (replyCallback) {
        await replyCallback({
          error: "User ID and Tenant ID are required"
        });
      }
      return;
    }
    
    const user = await getTenantUserById(tenantId, userId);
    
    if (!user || !user.active) {
      if (replyCallback) {
        await replyCallback({
          error: "User not found or inactive"
        });
      }
      return;
    }
    
    const roles = await getUserRoles(tenantId, userId);
    const permissions = await getUserPermissions(tenantId, userId);
    
    if (replyCallback) {
      await replyCallback({
        user: TenantUserDTO.fromObject(user),
        roles: roles.map(r => r.name),
        permissions
      });
    }
  } catch (error) {
    console.error("Error getting tenant user:", error);
    if (replyCallback) {
      await replyCallback({
        error: "Failed to get tenant user",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export const messageHandlers: Record<string, MessageHandler> = {
  "get-tenant": handleGetTenant,
  "verify-user": handleVerifyUser,
  "get-user-permissions": handleGetUserPermissions,
  "verify-admin-user": handleVerifyAdminUser,
  "verify-tenant-user": handleVerifyTenantUser,
  "get-admin-user": handleGetAdminUser,
  "get-tenant-user": handleGetTenantUser
};

export async function handleUnknownAction(
  message: any, 
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  if (replyCallback) {
    await replyCallback({
      error: "Unknown action",
      action: message.action,
    });
  }
}