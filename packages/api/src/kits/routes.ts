import { Router } from "express";
import { z } from "zod";
import type { ApiConfig } from "../config.js";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler } from "../http/errors.js";
import { validateBody } from "../http/validate.js";
import { jobRegistry } from "../jobs/registry.js";
import {
  createKit,
  createKitsBatch,
  deleteKit,
  getOwnedKit,
  listKits,
  retryKit,
} from "./service.js";
import { serializeKit, serializeKitSummary } from "./serialize.js";

const kitInput = z.object({
  jd: z.string().min(1, "Job description is required").max(40_000),
  companyUrl: z.string().url("A valid company website URL is required"),
  days: z.number().int().min(1).max(60),
});

const batchInput = z.object({
  cases: z.array(kitInput).min(1).max(25),
});

export function kitRoutes(config: ApiConfig): Router {
  const router = Router();
  router.use(requireAuth(config));

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const kits = await listKits(req.userId!);
      res.json({ kits: kits.map(serializeKitSummary) });
    }),
  );

  router.post(
    "/",
    validateBody(kitInput),
    asyncHandler(async (req, res) => {
      const { kit, deduped } = await createKit(req.userId!, req.body, config.core);
      res.status(deduped ? 200 : 201).json({ kit: serializeKit(kit), deduped });
    }),
  );

  router.post(
    "/batch",
    validateBody(batchInput),
    asyncHandler(async (req, res) => {
      const results = await createKitsBatch(req.userId!, req.body.cases, config.core);
      res.status(201).json({ results });
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const doc = await getOwnedKit(req.userId!, req.params.id!);
      res.json({ kit: serializeKit(doc) });
    }),
  );

  router.get(
    "/:id/progress",
    asyncHandler(async (req, res) => {
      const doc = await getOwnedKit(req.userId!, req.params.id!);
      const live = jobRegistry.progress(doc.id);
      res.json({
        status: doc.status,
        progress: live ?? doc.progress ?? [],
        error: doc.error ?? null,
        warnings: doc.warnings ?? [],
      });
    }),
  );

  router.post(
    "/:id/retry",
    asyncHandler(async (req, res) => {
      const doc = await retryKit(req.userId!, req.params.id!, config.core);
      res.json({ kit: serializeKit(doc) });
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      await deleteKit(req.userId!, req.params.id!);
      res.status(204).end();
    }),
  );

  return router;
}
