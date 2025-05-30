import { Request, Response, NextFunction } from "express";
import { RateLimiterMemory } from "rate-limiter-flexible";

const apiLimiter = new RateLimiterMemory({
  points: 100,
  duration: 60,
});

export function rateLimitAPI(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || "unknown";

  apiLimiter
    .consume(key)
    .then(() => {
      next();
    })
    .catch(() => {
      console.log(`Rate limit exceeded for IP: ${key}`);
      res.status(429).json({
        error: "Too many requests, please try again later",
        code: "RATE_LIMIT_EXCEEDED",
        status: 429,
      });
    });
}
