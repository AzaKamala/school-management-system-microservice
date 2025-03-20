import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { body } from "express-validator";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
} from "../utils/jwt";
import { authenticateJWT } from "../middlewares/authMiddleware";
import { rateLimitLogin } from "../middlewares/rateLimitMiddleware";
import { publishLoginEvent } from "../utils/rabbitmq";
import {
  isLoginBlocked,
  trackFailedLogin,
  resetFailedLoginAttempts,
  revokeAllUserRefreshTokens,
} from "../queries/authQueries";
const validate = require("../middlewares/validate");

const router = Router();

const loginValidator = [
  body("email").isEmail().withMessage("Valid email is required"),
  body("password").notEmpty().withMessage("Password is required"),
  body("tenantId")
    .optional()
    .isUUID()
    .withMessage("Valid tenant ID is required if provided"),
  validate,
];

async function publishLoginAudit(
  req: Request,
  success: boolean,
  userId?: string,
  tenantId?: string
) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const userAgent = req.headers["user-agent"] || "unknown";
  const email = req.body.email || "unknown";

  await publishLoginEvent({
    userId,
    email,
    tenantId,
    action: "login",
    status: success ? "success" : "failure",
    ip,
    userAgent,
    timestamp: new Date(),
    metadata: {
      method: "method",
      ...(tenantId ? { tenantId } : {}),
    },
  });
}

router.post(
  "/login",
  rateLimitLogin,
  loginValidator,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password, tenantId } = req.body;

      const isBlocked = await isLoginBlocked(email, req.ip || "unknown");
      if (isBlocked) {
        res.status(429).json({
          error: "Too many login attempts, please try again later",
          retryAfter: 15 * 60,
        });
        return;
      }

      // Mock user before I connect the auth service to the tenant service
      let user;
      let roles = [];
      let permissions = [];

      if (!tenantId) {
        user = {
          id: "admin-user-123",
          email: "admin@example.com",
          password: await bcrypt.hash("password123", 10),
          firstName: "Admin",
          lastName: "User",
          isAdmin: true,
        };

        roles = ["ADMIN"];
        permissions = ["manage_tenants", "view_tenants", "manage_admin_users"];
      } else {
        user = {
          id: "tenant-user-123",
          email: "user@example.com",
          password: await bcrypt.hash("password123", 10),
          firstName: "Tenant",
          lastName: "User",
          isAdmin: false,
          tenantId,
        };

        roles = ["TENANT_USER"];
        permissions = ["view_own_profile"];
      }

      if (
        user &&
        email === user.email &&
        (await bcrypt.compare(password, user.password))
      ) {
        await resetFailedLoginAttempts(email, req.ip || "unknown");

        const accessToken = generateAccessToken({
          userId: user.id,
          email: user.email,
          isAdmin: user.isAdmin,
          tenantId: user.tenantId,
          roles,
          permissions,
        });

        const refreshToken = await generateRefreshToken(
          user.id,
          user.isAdmin,
          user.tenantId
        );

        await publishLoginAudit(req, true, user.id, user.tenantId);

        res.status(200).json({
          accessToken,
          refreshToken,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            isAdmin: user.isAdmin,
            tenantId: user.tenantId,
          },
        });
      } else {
        await trackFailedLogin({
          email,
          ip: req.ip || "unknown",
          tenantId,
        });


        await publishLoginAudit(req, false, undefined, tenantId);

        res.status(401).json({ error: "Invalid email or password" });
      }
    } catch (error) {
      console.error("Login error:", error);

      try {
        await publishLoginAudit(req, false);
      } catch (auditError) {
        console.error("Failed to publish login audit:", auditError);
      }

      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post(
  "/refresh-token",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({ error: "Refresh token is required" });
        return;
      }

      const tokenData = await verifyRefreshToken(refreshToken);

      if (!tokenData) {
        res.status(401).json({ error: "Invalid or expired refresh token" });
        return;
      }

      await revokeRefreshToken(tokenData.id);

      // Mock user data
      let userInfo;
      let roles = [];
      let permissions = [];

      if (tokenData.adminUser) {
        userInfo = {
          id: tokenData.userId,
          email: "admin@example.com",
          firstName: "Admin",
          lastName: "User",
          isAdmin: true,
        };

        roles = ["ADMIN"];
        permissions = ["manage_tenants", "view_tenants", "manage_admin_users"];
      } else {
        userInfo = {
          id: tokenData.userId,
          email: "user@example.com",
          firstName: "Tenant",
          lastName: "User",
          isAdmin: false,
          tenantId: tokenData.tenantId,
        };

        roles = ["TENANT_USER"];
        permissions = ["view_own_profile"];
      }

      const accessToken = generateAccessToken({
        userId: userInfo.id,
        email: userInfo.email,
        isAdmin: userInfo.isAdmin,
        tenantId: tokenData.tenantId,
        roles,
        permissions,
      });

      const newRefreshToken = await generateRefreshToken(
        userInfo.id,
        userInfo.isAdmin,
        tokenData.tenantId
      );

      res.status(200).json({
        accessToken,
        refreshToken: newRefreshToken,
      });
    } catch (error) {
      console.error("Token refresh error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post(
  "/logout",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { refreshToken } = req.body;

      if (refreshToken) {
        const tokenData = await verifyRefreshToken(refreshToken);

        if (tokenData) {
          await revokeRefreshToken(tokenData.id);
        }
      }

      res.status(200).json({ message: "Logged out successfully" });
    } catch (error) {
      console.error("Logout error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
