import { Router } from "express";
import { z } from "zod";
import {
  analyseWeakSpots,
  orderForSession,
  recordReview,
  summarisePractice,
  type Confidence,
} from "@ipk/core";
import type { ApiConfig } from "../config.js";
import { requireAuth } from "../auth/middleware.js";
import { AppError, asyncHandler } from "../http/errors.js";
import { validateBody } from "../http/validate.js";
import { getOwnedKit } from "./service.js";
import { requireFlashcard } from "./mutate.js";

export function practiceRoutes(config: ApiConfig): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth(config));

  const load = (req: import("express").Request) => getOwnedKit(req.userId!, req.params.id!);
  const requireReady = (doc: Awaited<ReturnType<typeof load>>) => {
    if (doc.status !== "ready" || !doc.kit) throw AppError.conflict("Kit is not ready");
    return doc.kit;
  };

  /** Record a confidence rating for one flashcard. */
  router.post(
    "/:id/practice/:fid",
    validateBody(z.object({ confidence: z.number().int().min(1).max(5) })),
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      const kit = requireReady(doc);
      requireFlashcard(kit, req.params.fid!);

      const updated = recordReview(
        doc.practice[req.params.fid!],
        req.body.confidence as Confidence,
      );
      doc.practice = { ...doc.practice, [req.params.fid!]: updated };
      doc.markModified("practice");
      await doc.save();

      res.json({ record: updated, summary: summarisePractice(kit.flashcards, doc.practice) });
    }),
  );

  /** Ordered list of cards for the next session (least confident first). */
  router.get(
    "/:id/practice/next",
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      const kit = requireReady(doc);
      const limit = Math.min(Number(req.query.limit ?? 20) || 20, 100);
      const ordered = orderForSession(kit.flashcards, doc.practice).slice(0, limit);
      res.json({
        cards: ordered.map((s) => ({ card: s.card, record: s.record, due: s.due })),
        summary: summarisePractice(kit.flashcards, doc.practice),
      });
    }),
  );

  router.get(
    "/:id/practice/summary",
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      const kit = requireReady(doc);
      res.json({ summary: summarisePractice(kit.flashcards, doc.practice) });
    }),
  );

  /** "Weak spots" report — where to spend the next hour (optional feature). */
  router.get(
    "/:id/weak-spots",
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      const kit = requireReady(doc);
      res.json({ weakSpots: analyseWeakSpots(kit, doc.practice) });
    }),
  );

  router.post(
    "/:id/practice/reset",
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      requireReady(doc);
      doc.practice = {};
      doc.markModified("practice");
      await doc.save();
      res.status(204).end();
    }),
  );

  return router;
}
