import { Router, Request, Response } from "express";
import { body } from "express-validator";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
} from "../utils/jwt";
import { authenticateJWT } from "../middlewares/authMiddleware";
import { rateLimitLogin } from "../middlewares/rateLimitMiddleware";
import { publishLoginEvent } from "../utils/rabbitmq";
import {
  isLoginBlocked,
  trackFailedLogin,
  resetFailedLoginAttempts,
} from "../queries/authQueries";
import { tenantServiceCircuitBreaker } from "../utils/circuitBreaker";
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

const refreshTokenValidator = [
  body("refreshToken").notEmpty().withMessage("Refresh token is required"),
  validate,
];

const logoutValidator = [body("refreshToken").optional().isString(), validate];

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
      method: "password",
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

      try {
        let authenticatedUser;
        let roles = [];
        let permissions = [];

        if (!tenantId) {
          try {
            const result = await tenantServiceCircuitBreaker.executeRequest(
              "tenant.requests",
              {
                action: "verify-admin-user",
                data: {
                  email,
                  password,
                },
              }
            );

            if (!result.verified) {
              await trackFailedLogin({
                email,
                ip: req.ip || "unknown",
              });

              await publishLoginAudit(req, false);
              res.status(401).json({ error: "Invalid email or password" });
              return;
            }

            authenticatedUser = result.user;
            roles = result.roles || [];
            permissions = result.permissions || [];
          } catch (error) {
            console.error("Admin authentication error:", error);
            res.status(500).json({ error: "Error during authentication" });
            return;
          }
        } else {
          try {
            const result = await tenantServiceCircuitBreaker.executeRequest(
              "tenant.requests",
              {
                action: "verify-tenant-user",
                data: {
                  email,
                  password,
                  tenantId,
                },
              }
            );

            if (!result.verified) {
              await trackFailedLogin({
                email,
                ip: req.ip || "unknown",
                tenantId,
              });

              await publishLoginAudit(req, false, undefined, tenantId);
              res.status(401).json({ error: "Invalid email or password" });
              return;
            }

            authenticatedUser = result.user;
            roles = result.roles || [];
            permissions = result.permissions || [];
          } catch (error) {
            console.error("Tenant user authentication error:", error);
            res.status(500).json({ error: "Error during authentication" });
            return;
          }
        }

        await resetFailedLoginAttempts(email, req.ip || "unknown");

        const accessToken = generateAccessToken({
          userId: authenticatedUser.id,
          email: authenticatedUser.email,
          isAdmin: !tenantId,
          tenantId: tenantId || undefined,
          roles,
          permissions,
        });

        const refreshToken = await generateRefreshToken(
          authenticatedUser.id,
          !tenantId,
          tenantId || undefined
        );

        await publishLoginAudit(req, true, authenticatedUser.id, tenantId);

        res.status(200).json({
          accessToken,
          refreshToken,
          user: {
            id: authenticatedUser.id,
            email: authenticatedUser.email,
            firstName: authenticatedUser.firstName,
            lastName: authenticatedUser.lastName,
            isAdmin: !tenantId,
            tenantId: tenantId || undefined,
          },
        });
      } catch (error) {
        console.error("Login error:", error);

        try {
          await publishLoginAudit(req, false);
        } catch (auditError) {
          console.error("Failed to publish login audit:", auditError);
        }

        res.status(500).json({ error: "Internal server error" });
      }
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post(
  "/refresh-token",
  refreshTokenValidator,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { refreshToken } = req.body;

      const tokenData = await verifyRefreshToken(refreshToken);

      if (!tokenData) {
        res.status(401).json({ error: "Invalid or expired refresh token" });
        return;
      }

      await revokeRefreshToken(tokenData.id);

      try {
        let userData;
        let roles = [];
        let permissions = [];

        if (tokenData.adminUser) {
          const result = await tenantServiceCircuitBreaker.executeRequest(
            "tenant.requests",
            {
              action: "get-admin-user",
              data: {
                userId: tokenData.userId,
              },
            }
          );

          if (!result.user) {
            res.status(404).json({ error: "User not found or inactive" });
            return;
          }

          userData = result.user;
          roles = result.roles || [];
          permissions = result.permissions || [];
        } else {
          const result = await tenantServiceCircuitBreaker.executeRequest(
            "tenant.requests",
            {
              action: "get-tenant-user",
              data: {
                userId: tokenData.userId,
                tenantId: tokenData.tenantId,
              },
            }
          );

          if (!result.user) {
            res.status(404).json({ error: "User not found or inactive" });
            return;
          }

          userData = result.user;
          roles = result.roles || [];
          permissions = result.permissions || [];
        }

        const accessToken = generateAccessToken({
          userId: tokenData.userId,
          email: userData.email,
          isAdmin: tokenData.adminUser,
          tenantId: tokenData.tenantId,
          roles,
          permissions,
        });

        const newRefreshToken = await generateRefreshToken(
          tokenData.userId,
          tokenData.adminUser,
          tokenData.tenantId
        );

        res.status(200).json({
          accessToken,
          refreshToken: newRefreshToken,
          user: {
            id: userData.id,
            email: userData.email,
            firstName: userData.firstName,
            lastName: userData.lastName,
            isAdmin: tokenData.adminUser,
            tenantId: tokenData.tenantId,
          },
        });
      } catch (error) {
        console.error("Error refreshing token:", error);
        res.status(500).json({ error: "Failed to refresh token" });
      }
    } catch (error) {
      console.error("Token refresh error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post(
  "/logout",
  authenticateJWT,
  logoutValidator,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { refreshToken } = req.body;
      const userId = req.user?.userId;
      const isAdmin = req.user?.isAdmin || false;

      if (refreshToken) {
        const tokenData = await verifyRefreshToken(refreshToken);
        if (tokenData) {
          await revokeRefreshToken(tokenData.id);
        }
      }
      else if (userId) {
        await revokeAllUserRefreshTokens(userId, isAdmin);
      }

      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";

      await publishLoginEvent({
        userId,
        email: req.user?.email || "unknown",
        tenantId: req.user?.tenantId,
        action: "logout",
        status: "success",
        ip,
        userAgent,
        timestamp: new Date(),
      });

      res.status(200).json({ message: "Logged out successfully" });
    } catch (error) {
      console.error("Logout error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get(
  "/verify-token",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.user?.tenantId && !req.user.isAdmin) {
        try {
          const result = await tenantServiceCircuitBreaker.executeRequest(
            "tenant.requests",
            {
              action: "get-user-permissions",
              data: {
                userId: req.user.userId,
                tenantId: req.user.tenantId,
              },
            }
          );

          if (result.permissions) {
            req.user.permissions = result.permissions;
          }
        } catch (error) {
          console.error("Error getting updated permissions:", error);
        }
      }

      res.status(200).json({
        valid: true,
        user: {
          userId: req.user?.userId,
          email: req.user?.email,
          isAdmin: req.user?.isAdmin,
          tenantId: req.user?.tenantId,
          roles: req.user?.roles,
          permissions: req.user?.permissions,
        },
      });
    } catch (error) {
      console.error("Token verification error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;