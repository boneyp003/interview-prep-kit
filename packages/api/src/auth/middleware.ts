import type { NextFunction, Request, Response } from "express";
import type { ApiConfig } from "../config.js";
import { AppError } from "../http/errors.js";
import { sessionCookie, verifySession } from "./tokens.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

/**
 * Rejects any request without a valid, unexpired session. Distinguishes an
 * expired session (client should re-authenticate quietly) from a malformed or
 * tampered one.
 */
export function requireAuth(config: ApiConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = readCookie(req.headers.cookie, sessionCookie.name);
    if (!token) {
      next(AppError.unauthorized("No session"));
      return;
    }
    const result = verifySession(token, config.authSecret);
    if (!result.ok) {
      next(
        result.reason === "expired"
          ? new AppError(401, "SESSION_EXPIRED", "Session expired; please sign in again")
          : new AppError(401, "SESSION_INVALID", "Invalid session"),
      );
      return;
    }
    req.userId = result.claims.sub;
    req.userEmail = result.claims.email;
    next();
  };
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
