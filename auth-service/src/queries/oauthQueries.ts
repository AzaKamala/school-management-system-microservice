import { v4 as uuidv4 } from "uuid";
import { publishLoginEvent } from "../utils/rabbitmq";
import { Request } from "express";
import { generateAccessToken, generateRefreshToken } from "../utils/jwt";

interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
}

export async function handleGoogleCallback(
  code: string,
  tenantId?: string,
  req?: Request
) {
  try {
    // Mock profile
    const profile: GoogleProfile = {
      sub: "google-id-123",
      email: "user@example.com",
      name: "Example User",
      given_name: "Example",
      family_name: "User",
      picture: "https://example.com/picture.jpg",
    };

    if (!tenantId) {
      if (req) {
        await publishLoginEvent({
          email: profile.email,
          action: "login",
          status: "failure",
          ip: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"] || "unknown",
          timestamp: new Date(),
          metadata: {
            method: "oauth",
            provider: "google",
            reason: "missing_tenant",
          },
        });
      }
      throw new Error("Tenant ID is required for OAuth login");
    }

    // Mock user data
    // Just for testing purposes
    const userId = uuidv4();
    const roles = ["STUDENT"];
    const permissions = ["view_own_profile"];

    const accessToken = generateAccessToken({
      userId,
      email: profile.email,
      isAdmin: false,
      tenantId,
      roles,
      permissions,
    });

    const refreshToken = await generateRefreshToken(userId, false, tenantId);

    if (req) {
      await publishLoginEvent({
        userId,
        email: profile.email,
        tenantId,
        action: "login",
        status: "success",
        ip: req.ip || req.socket.remoteAddress || "unknown",
        userAgent: req.headers["user-agent"] || "unknown",
        timestamp: new Date(),
        metadata: {
          method: "oauth",
          provider: "google",
        },
      });
    }

    return {
      accessToken,
      refreshToken,
      user: {
        id: userId,
        email: profile.email,
        firstName: profile.given_name,
        lastName: profile.family_name,
        isAdmin: false,
        tenantId,
      },
    };
  } catch (error) {
    console.error("Google OAuth error:", error);
    throw error;
  }
}
