import express, { type Express } from "express";
import cors from "cors";
import type { ApiConfig } from "./config.js";
import { authRoutes } from "./auth/routes.js";
import { kitRoutes } from "./kits/routes.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";

/** Build the Express app. No listening, no DB connect — for tests and server.ts. */
export function createApp(config: ApiConfig): Express {
  const app = express();

  app.use(
    cors({
      origin: config.webOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/auth", authRoutes(config));
  app.use("/kits", kitRoutes(config));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
