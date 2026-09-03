import { Router } from "express";
import { z } from "zod";
import {
  QUESTION_CATEGORIES,
  REQUIREMENT_KINDS,
  REQUIREMENT_PRIORITIES,
  checkCoverage,
  recomputeDayMinutes,
  regenerateBrief,
  regenerateCategory,
  regenerateSchedule,
  createLlm,
  type Kit,
} from "@ipk/core";
import type { ApiConfig } from "../config.js";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler, AppError } from "../http/errors.js";
import { validateBody } from "../http/validate.js";
import { getOwnedKit } from "./service.js";
import { mutateKit, requireFlashcard, requireQuestion } from "./mutate.js";
import { serializeKit } from "./serialize.js";
import type { ItemStateMap } from "@ipk/core";

const now = () => new Date();

function touch(map: ItemStateMap, id: string, patch: Partial<ItemStateMap[string]>): void {
  const current = map[id] ?? { origin: "generated", edited: false, pinned: false, updatedAt: "" };
  map[id] = { ...current, ...patch, updatedAt: now().toISOString() };
}

function recomputeCoverage(kit: Kit): void {
  const cov = checkCoverage(kit.role.requirements, kit.questions);
  kit.coverage = { ...kit.coverage, uncovered_requirement_ids: cov.uncoveredRequirementIds };
}

const questionPatch = z
  .object({
    prompt: z.string().min(1).max(600),
    answer_outline: z.string().max(4000),
    difficulty: z.number().int().min(1).max(3),
    category: z.enum(QUESTION_CATEGORIES),
    requirement_ids: z.array(z.string().min(1)).min(1),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");

const newQuestion = z.object({
  prompt: z.string().min(1).max(600),
  answer_outline: z.string().max(4000).default(""),
  difficulty: z.number().int().min(1).max(3).default(2),
  category: z.enum(QUESTION_CATEGORIES),
  requirement_ids: z.array(z.string().min(1)).min(1),
});

const flashcardPatch = z
  .object({ front: z.string().min(1).max(400), back: z.string().min(1).max(2000), requirement_ids: z.array(z.string().min(1)).min(1) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field");

const newFlashcard = z.object({
  front: z.string().min(1).max(400),
  back: z.string().min(1).max(2000),
  requirement_ids: z.array(z.string().min(1)).min(1),
});

export function builderRoutes(config: ApiConfig): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth(config));

  const load = (req: import("express").Request) => getOwnedKit(req.userId!, req.params.id!);

  // ── Questions ────────────────────────────────────────────────────────────
  router.patch(
    "/:id/questions/:qid",
    validateBody(questionPatch),
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      const patch = req.body as z.infer<typeof questionPatch>;
      await mutateKit(doc, (kit) => {
        const q = requireQuestion(kit, req.params.qid!);
        assertRequirementIds(kit, patch.requirement_ids);
        Object.assign(q, patch);
        touch(doc.itemState, q.id, { edited: true });
        if (patch.requirement_ids || patch.category) recomputeCoverage(kit);
      });
      res.json({ kit: serializeKit(doc) });
    }),
  );

  router.post(
    "/:id/questions/:qid/pin",
    validateBody(z.object({ pinned: z.boolean() })),
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      await mutateKit(doc, (kit) => {
        requireQuestion(kit, req.params.qid!);
        touch(doc.itemState, req.params.qid!, { pinned: req.body.pinned });
      });
      res.json({ kit: serializeKit(doc) });
    }),
  );

  router.post(
    "/:id/questions",
    validateBody(newQuestion),
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      const body = req.body as z.infer<typeof newQuestion>;
      let newId = "";
      await mutateKit(doc, (kit) => {
        assertRequirementIds(kit, body.requirement_ids);
        newId = nextId(kit.questions.map((q) => q.id), "q");
        kit.questions.push({ id: newId, ...body });
        touch(doc.itemState, newId, { origin: "user" });
        recomputeCoverage(kit);
      });
      res.status(201).json({ kit: serializeKit(doc), id: newId });
    }),
  );

  router.delete(
    "/:id/questions/:qid",
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      await mutateKit(doc, (kit) => {
        const before = kit.questions.length;
        kit.questions = kit.questions.filter((q) => q.id !== req.params.qid);
        if (kit.questions.length === before) throw AppError.notFound("Question not found");
        delete doc.itemState[req.params.qid!];
        for (const day of kit.schedule.days) {
          day.question_ids = day.question_ids.filter((id) => id !== req.params.qid);
        }
        recomputeDayMinutes(kit.schedule, kit.questions);
        recomputeCoverage(kit);
      });
      res.json({ kit: serializeKit(doc) });
    }),
  );

  router.put(
    "/:id/questions/order",
    validateBody(z.object({ order: z.array(z.string().min(1)).min(1) })),
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      await mutateKit(doc, (kit) => {
        const ids = new Set(kit.questions.map((q) => q.id));
        const order = req.body.order as string[];
        if (order.length !== ids.size || order.some((id) => !ids.has(id))) {
          throw AppError.badRequest("order must be a permutation of the current question ids");
        }
        const byId = new Map(kit.questions.map((q) => [q.id, q]));
        kit.questions = order.map((id) => byId.get(id)!);
      });
      res.json({ kit: serializeKit(doc) });
    }),
  );

  // ── Flashcards ───────────────────────────────────────────────────────────
  router.patch(
    "/:id/flashcards/:fid",
    validateBody(flashcardPatch),
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      await mutateKit(doc, (kit) => {
        const f = requireFlashcard(kit, req.params.fid!);
        assertRequirementIds(kit, req.body.requirement_ids);
        Object.assign(f, req.body);
        touch(doc.itemState, f.id, { edited: true });
      });
      res.json({ kit: serializeKit(doc) });
    }),
  );

  router.post(
    "/:id/flashcards",
    validateBody(newFlashcard),
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      let newId = "";
      await mutateKit(doc, (kit) => {
        assertRequirementIds(kit, req.body.requirement_ids);
        newId = nextId(kit.flashcards.map((f) => f.id), "f");
        kit.flashcards.push({ id: newId, ...(req.body as z.infer<typeof newFlashcard>) });
        touch(doc.itemState, newId, { origin: "user" });
      });
      res.status(201).json({ kit: serializeKit(doc), id: newId });
    }),
  );

  router.delete(
    "/:id/flashcards/:fid",
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      await mutateKit(doc, (kit) => {
        const before = kit.flashcards.length;
        kit.flashcards = kit.flashcards.filter((f) => f.id !== req.params.fid);
        if (kit.flashcards.length === before) throw AppError.notFound("Flashcard not found");
        delete doc.itemState[req.params.fid!];
        delete doc.practice[req.params.fid!];
      });
      res.json({ kit: serializeKit(doc) });
    }),
  );

  // ── Brief / role / schedule ──────────────────────────────────────────────
  router.patch(
    "/:id/brief",
    validateBody(z.object({ summary: z.string().max(4000), what_they_do: z.string().max(4000) }).partial().refine((v) => Object.keys(v).length > 0, "empty patch")),
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      await mutateKit(doc, (kit) => {
        Object.assign(kit.company_brief, req.body);
        doc.sectionState.companyBrief.edited = true;
      });
      res.json({ kit: serializeKit(doc) });
    }),
  );

  router.patch(
    "/:id/role",
    validateBody(
      z
        .object({
          title: z.string().max(200),
          seniority: z.string().max(80),
          responsibilities: z.array(z.string().min(1).max(400)),
          requirements: z.array(
            z.object({
              id: z.string().min(1),
              text: z.string().min(1).max(400),
              kind: z.enum(REQUIREMENT_KINDS),
              priority: z.enum(REQUIREMENT_PRIORITIES),
            }),
          ),
        })
        .partial()
        .refine((v) => Object.keys(v).length > 0, "empty patch"),
    ),
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      await mutateKit(doc, (kit) => {
        const body = req.body as Partial<Kit["role"]>;
        if (body.requirements) {
          // ids may only be edited in place, not removed while questions reference them
          const newIds = new Set(body.requirements.map((r) => r.id));
          const referenced = new Set(kit.questions.flatMap((q) => q.requirement_ids));
          for (const rid of referenced) {
            if (!newIds.has(rid)) throw AppError.badRequest(`Requirement ${rid} is still referenced by a question`);
          }
        }
        Object.assign(kit.role, body);
        recomputeCoverage(kit);
      });
      res.json({ kit: serializeKit(doc) });
    }),
  );

  router.patch(
    "/:id/schedule",
    validateBody(
      z.object({
        days: z.array(
          z.object({
            day: z.number().int().positive(),
            focus: z.string().max(300),
            question_ids: z.array(z.string().min(1)),
            minutes: z.number().int().min(0),
          }),
        ),
      }),
    ),
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      await mutateKit(doc, (kit) => {
        const days = req.body.days as Kit["schedule"]["days"];
        if (days.length !== kit.schedule.days_available) {
          throw AppError.badRequest(`Schedule must have exactly ${kit.schedule.days_available} days`);
        }
        const valid = new Set(kit.questions.map((q) => q.id));
        for (const d of days) for (const qid of d.question_ids) {
          if (!valid.has(qid)) throw AppError.badRequest(`Unknown question id ${qid}`);
        }
        kit.schedule.days = days.map((d, i) => ({ ...d, day: i + 1 }));
        doc.sectionState.schedule.edited = true;
      });
      res.json({ kit: serializeKit(doc) });
    }),
  );

  // ── Regenerate a single section ──────────────────────────────────────────
  router.post(
    "/:id/regenerate",
    validateBody(
      z.object({
        section: z.enum(["brief", "schedule", "questions"]),
        category: z.enum(QUESTION_CATEGORIES).optional(),
      }),
    ),
    asyncHandler(async (req, res) => {
      const doc = await load(req);
      if (doc.status !== "ready" || !doc.kit) throw AppError.conflict("Kit is not ready");
      if (!doc.research) throw AppError.conflict("No research snapshot stored for this kit; run a full retry first");

      const { section, category } = req.body as { section: string; category?: (typeof QUESTION_CATEGORIES)[number] };
      const llm = createLlm(config.core);

      await mutateKit(doc, async (kit) => {
        if (section === "brief") {
          kit.company_brief = await regenerateBrief(doc.research!, llm);
          doc.sectionState.companyBrief.edited = false;
        } else if (section === "schedule") {
          kit.schedule = regenerateSchedule(kit);
          doc.sectionState.schedule.edited = false;
        } else {
          if (!category) throw AppError.badRequest("category is required when section is 'questions'");
          const result = await regenerateCategory({
            kit,
            itemState: doc.itemState,
            category,
            research: doc.research!,
            scheduleEdited: doc.sectionState.schedule.edited,
            llm,
          });
          kit.questions = result.questions;
          kit.schedule = result.schedule;
          kit.coverage = result.coverage;
          doc.itemState = result.itemState;
        }
      });
      res.json({ kit: serializeKit(doc) });
    }),
  );

  return router;
}

function assertRequirementIds(kit: Kit, ids?: string[]): void {
  if (!ids) return;
  const valid = new Set(kit.role.requirements.map((r) => r.id));
  for (const id of ids) if (!valid.has(id)) throw AppError.badRequest(`Unknown requirement id ${id}`);
}

function nextId(existing: string[], prefix: string): string {
  let max = 0;
  for (const id of existing) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}
