import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

const prisma = new PrismaClient();

interface FailedLoginData {
  email: string;
  ip: string;
  tenantId?: string;
}

export async function trackFailedLogin(
  data: FailedLoginData
): Promise<boolean> {
  try {
    const { email, ip, tenantId } = data;

    const existingAttempt = await prisma.failedLoginAttempt.findFirst({
      where: { email, ip },
    });

    if (existingAttempt) {
      const attemptCount = existingAttempt.attemptCount + 1;
      let blockedUntil = null;

      if (attemptCount >= 5) {
        blockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }

      await prisma.failedLoginAttempt.update({
        where: { id: existingAttempt.id },
        data: {
          attemptCount,
          blockedUntil,
          lastAttemptAt: new Date(),
        },
      });
    } else {
      await prisma.failedLoginAttempt.create({
        data: {
          email,
          ip,
          tenantId,
          attemptCount: 1,
          lastAttemptAt: new Date(),
        },
      });
    }

    return true;
  } catch (error) {
    console.error("Error tracking failed login:", error);
    return false;
  }
}

export async function isLoginBlocked(
  email: string,
  ip: string
): Promise<boolean> {
  try {
    const failedAttempt = await prisma.failedLoginAttempt.findFirst({
      where: { email, ip },
    });

    if (!failedAttempt) return false;

    if (failedAttempt.blockedUntil && failedAttempt.blockedUntil > new Date()) {
      return true;
    }

    if (
      failedAttempt.attemptCount >= 5 &&
      failedAttempt.lastAttemptAt > new Date(Date.now() - 15 * 60 * 1000)
    ) {
      await prisma.failedLoginAttempt.update({
        where: { id: failedAttempt.id },
        data: {
          blockedUntil: new Date(Date.now() + 15 * 60 * 1000),
        },
      });
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error checking if login is blocked:", error);
    return false;
  }
}

export async function resetFailedLoginAttempts(
  email: string,
  ip: string
): Promise<boolean> {
  try {
    await prisma.failedLoginAttempt.deleteMany({
      where: { email, ip },
    });
    return true;
  } catch (error) {
    console.error("Error resetting failed login attempts:", error);
    return false;
  }
}

export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

export async function findRefreshTokenById(tokenId: string): Promise<any> {
  try {
    return await prisma.refreshToken.findUnique({
      where: { id: tokenId },
    });
  } catch (error) {
    console.error("Error finding refresh token:", error);
    return null;
  }
}

export async function createRefreshToken(
  userId: string,
  isAdmin: boolean,
  tenantId?: string
): Promise<string> {
  try {
    const tokenId = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 5);

    await prisma.refreshToken.create({
      data: {
        id: tokenId,
        token: tokenId,
        userId,
        adminUser: isAdmin,
        tenantId,
        expiresAt,
        revoked: false,
      },
    });

    return tokenId;
  } catch (error) {
    console.error("Error creating refresh token:", error);
    throw error;
  }
}

export async function revokeRefreshToken(tokenId: string): Promise<boolean> {
  try {
    await prisma.refreshToken.update({
      where: { id: tokenId },
      data: { revoked: true },
    });
    return true;
  } catch (error) {
    console.error("Error revoking refresh token:", error);
    return false;
  }
}

export async function revokeAllUserRefreshTokens(
  userId: string,
  isAdmin: boolean
): Promise<boolean> {
  try {
    await prisma.refreshToken.updateMany({
      where: {
        userId,
        adminUser: isAdmin,
      },
      data: { revoked: true },
    });
    return true;
  } catch (error) {
    console.error("Error revoking all user refresh tokens:", error);
    return false;
  }
}
