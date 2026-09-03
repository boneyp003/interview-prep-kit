import { Router } from "express";
import { z } from "zod";
import type { ApiConfig } from "../config.js";
import { User } from "../db/models/user.js";
import { AppError, asyncHandler } from "../http/errors.js";
import { validateBody } from "../http/validate.js";
import { hashPassword, verifyPassword } from "./password.js";
import { requireAuth } from "./middleware.js";
import { issueSession, sessionCookie } from "./tokens.js";

const credentials = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export function authRoutes(config: ApiConfig): Router {
  const router = Router();

  router.post(
    "/register",
    validateBody(credentials),
    asyncHandler(async (req, res) => {
      const { email, password } = req.body as z.infer<typeof credentials>;
      const existing = await User.findOne({ email: email.toLowerCase() }).lean();
      if (existing) throw AppError.conflict("An account with that email already exists");

      const user = await User.create({ email, passwordHash: await hashPassword(password) });
      setSession(res, config, user.id, user.email);
      res.status(201).json({ user: { id: user.id, email: user.email } });
    }),
  );

  router.post(
    "/login",
    validateBody(credentials),
    asyncHandler(async (req, res) => {
      const { email, password } = req.body as z.infer<typeof credentials>;
      const user = await User.findOne({ email: email.toLowerCase() });
      const ok = user ? await verifyPassword(password, user.passwordHash) : false;
      if (!user || !ok) throw AppError.unauthorized("Incorrect email or password");

      setSession(res, config, user.id, user.email);
      res.json({ user: { id: user.id, email: user.email } });
    }),
  );

  router.post("/logout", (_req, res) => {
    res.setHeader("Set-Cookie", sessionCookie.clear(config.isProduction));
    res.status(204).end();
  });

  router.get(
    "/me",
    requireAuth(config),
    asyncHandler(async (req, res) => {
      const user = await User.findById(req.userId).lean();
      if (!user) throw AppError.unauthorized("Account no longer exists");
      res.json({ user: { id: String(user._id), email: user.email } });
    }),
  );

  return router;
}

function setSession(
  res: import("express").Response,
  config: ApiConfig,
  userId: string,
  email: string,
): void {
  const token = issueSession({ sub: userId, email }, config.authSecret, config.sessionTtlHours);
  res.setHeader("Set-Cookie", sessionCookie.serialize(token, config.sessionTtlHours, config.isProduction));
}
