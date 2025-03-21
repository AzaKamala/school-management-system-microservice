import { Router, Request, Response } from "express";
import { getAuditLogs, getAuditLogById } from "../queries/auditLogQueries";
import { param, query } from "express-validator";
const validate = require("../middlewares/validate");
import { rateLimitAPI } from "../middlewares/rateLimitMiddleware";
import {
  authenticateJWT,
  requirePermission,
  requireTenantAccess,
} from "../middlewares/authMiddleware";

const router = Router();

const auditLogQueryValidator = [
  param("tenantId").isUUID(4).withMessage("Valid tenant ID is required"),
  query("status").optional().isString(),
  query("action").optional().isString(),
  query("userId")
    .optional()
    .isUUID(4)
    .withMessage("User ID must be a valid UUID"),
  query("startDate")
    .optional()
    .isISO8601()
    .withMessage("Valid ISO date required for startDate"),
  query("endDate")
    .optional()
    .isISO8601()
    .withMessage("Valid ISO date required for endDate"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage("Limit must be between 1 and 1000"),
  query("offset")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Offset must be a positive number"),
  validate,
];

const auditLogDetailValidator = [
  param("tenantId").isUUID(4).withMessage("Valid tenant ID is required"),
  param("id").isUUID(4).withMessage("Valid audit log ID is required"),
  validate,
];

router.get(
  "/:tenantId/audit",
  rateLimitAPI,
  authenticateJWT,
  requireTenantAccess,
  requirePermission("view_audit_logs"),
  auditLogQueryValidator,
  async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.params;
      const {
        status,
        action,
        userId,
        startDate: startDateStr,
        endDate: endDateStr,
        limit: limitStr,
        offset: offsetStr,
      } = req.query;

      const userIdFilter =
        req.user?.isAdmin || req.user?.permissions.includes("view_tenant_users")
          ? (userId as string)
          : req.user?.userId;

      const startDate = startDateStr
        ? new Date(startDateStr as string)
        : undefined;
      const endDate = endDateStr ? new Date(endDateStr as string) : undefined;
      const limit = limitStr ? parseInt(limitStr as string) : 100;
      const offset = offsetStr ? parseInt(offsetStr as string) : 0;

      const result = await getAuditLogs(tenantId, {
        userId: userIdFilter,
        status: status as string,
        action: action as string,
        startDate,
        endDate,
        limit,
        offset,
      });

      res.status(200).json(result);
    } catch (error) {
      console.error(`Error fetching audit logs:`, error);
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  }
);

// Get a specific audit log detail
router.get(
  "/:tenantId/audit/:id",
  rateLimitAPI,
  authenticateJWT,
  requireTenantAccess,
  requirePermission("view_audit_logs"),
  auditLogDetailValidator,
  async (req: Request, res: Response) => {
    try {
      const { tenantId, id } = req.params;

      const auditLog = await getAuditLogById(id);

      if (!auditLog) {
        res.status(404).json({ error: "Audit log not found" });
        return;
      }

      if (auditLog.tenantId !== tenantId) {
        res.status(404).json({ error: "Audit log not found in this tenant" });
        return;
      }

      if (
        !req.user?.isAdmin &&
        !req.user?.permissions.includes("view_tenant_users") &&
        auditLog.userId !== req.user?.userId
      ) {
        res.status(403).json({ error: "Access denied to this audit log" });
        return;
      }

      res.status(200).json({ data: auditLog });
      return;
    } catch (error) {
      console.error(`Error fetching audit log detail:`, error);
      res.status(500).json({ error: "Failed to fetch audit log detail" });
      return;
    }
  }
);

export default router;
