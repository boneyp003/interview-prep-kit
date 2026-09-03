import express, { type Express } from "express";
import cors from "cors";
import type { ApiConfig } from "./config.js";
import { authRoutes } from "./auth/routes.js";
import { kitRoutes } from "./kits/routes.js";
import { builderRoutes } from "./kits/builder-routes.js";
import { practiceRoutes } from "./kits/practice-routes.js";
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
  // More specific kit sub-resources first, then the base CRUD router.
  app.use("/kits", builderRoutes(config));
  app.use("/kits", practiceRoutes(config));
  app.use("/kits", kitRoutes(config));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
