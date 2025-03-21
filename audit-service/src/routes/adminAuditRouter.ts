import { Router, Request, Response } from "express";
import { getAdminAuditLogs, getAuditLogById } from "../queries/auditLogQueries";
import { query, param } from "express-validator";
const validate = require("../middlewares/validate");
import { rateLimitAPI } from "../middlewares/rateLimitMiddleware";
import {
  authenticateJWT,
  requireAdmin,
  requirePermission,
} from "../middlewares/authMiddleware";

const router = Router();

const adminAuditLogQueryValidator = [
  query("tenantId")
    .optional()
    .isUUID(4)
    .withMessage("Valid tenant ID is required"),
  query("status").optional().isString(),
  query("action").optional().isString(),
  query("userId").optional().isUUID(4).withMessage("Valid user ID is required"),
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

const adminAuditLogDetailValidator = [
  param("id").isUUID(4).withMessage("Valid audit log ID is required"),
  validate,
];

router.get(
  "/",
  rateLimitAPI,
  authenticateJWT,
  requireAdmin,
  requirePermission("view_audit_logs"),
  adminAuditLogQueryValidator,
  async (req: Request, res: Response) => {
    try {
      const {
        tenantId,
        status,
        action,
        userId,
        startDate: startDateStr,
        endDate: endDateStr,
        limit: limitStr,
        offset: offsetStr,
      } = req.query;

      const startDate = startDateStr
        ? new Date(startDateStr as string)
        : undefined;
      const endDate = endDateStr ? new Date(endDateStr as string) : undefined;
      const limit = limitStr ? parseInt(limitStr as string) : 100;
      const offset = offsetStr ? parseInt(offsetStr as string) : 0;

      let parsedTenantId: string | null | undefined = undefined;
      if (tenantId === "null") {
        parsedTenantId = null;
      } else if (tenantId) {
        parsedTenantId = tenantId as string;
      }

      const result = await getAdminAuditLogs({
        tenantId: parsedTenantId === null ? undefined : parsedTenantId,
        userId: userId as string,
        status: status as string,
        action: action as string,
        startDate,
        endDate,
        limit,
        offset,
      });

      res.status(200).json(result);
    } catch (error) {
      console.error(`Error fetching admin audit logs:`, error);
      res.status(500).json({ error: "Failed to fetch admin audit logs" });
    }
  }
);

router.get(
  "/:id",
  rateLimitAPI,
  authenticateJWT,
  requireAdmin,
  requirePermission("view_audit_logs"),
  adminAuditLogDetailValidator,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const auditLog = await getAuditLogById(id);

      if (!auditLog) {
        res.status(404).json({ error: "Audit log not found" });
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
