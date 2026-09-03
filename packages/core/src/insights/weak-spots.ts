import type { Kit } from "../schema/kit.js";
import type { PracticeMap } from "../practice/index.js";

/**
 * Optional feature — the "weak spots" report.
 *
 * A prepared kit can hold 25 questions and 15 flashcards across a week. The
 * candidate's real problem is knowing *where to spend the next hour*. This
 * pulls together three signals the app already has, per requirement:
 *
 *   - coverage      how many questions actually target it (a thin area)
 *   - recall        how confident practice ratings on its flashcards are
 *   - schedule      which day it lands on (is it already behind you?)
 *
 * and ranks requirements by a weakness score, must-haves weighted heavier.
 * Everything here is deterministic; it is not another model call.
 */

export interface WeakSpot {
  requirementId: string;
  text: string;
  priority: "must" | "nice";
  kind: string;
  questionCount: number;
  flashcardCount: number;
  flashcardsRated: number;
  averageConfidence: number | null;
  scheduledDays: number[];
  score: number;
  reasons: string[];
}

export function analyseWeakSpots(kit: Kit, practice: PracticeMap): WeakSpot[] {
  const questionsByReq = new Map<string, number>();
  for (const q of kit.questions) {
    for (const rid of q.requirement_ids) {
      questionsByReq.set(rid, (questionsByReq.get(rid) ?? 0) + 1);
    }
  }

  const scheduledQ = new Map<string, number[]>();
  for (const day of kit.schedule.days) {
    for (const qid of day.question_ids) {
      const q = kit.questions.find((x) => x.id === qid);
      if (!q) continue;
      for (const rid of q.requirement_ids) {
        const list = scheduledQ.get(rid) ?? [];
        if (!list.includes(day.day)) list.push(day.day);
        scheduledQ.set(rid, list);
      }
    }
  }

  const spots: WeakSpot[] = kit.role.requirements.map((req) => {
    const cards = kit.flashcards.filter((f) => f.requirement_ids.includes(req.id));
    const rated = cards.filter((c) => practice[c.id]);
    const avg =
      rated.length > 0
        ? rated.reduce((s, c) => s + (practice[c.id]?.lastConfidence ?? 0), 0) / rated.length
        : null;

    const questionCount = questionsByReq.get(req.id) ?? 0;
    const reasons: string[] = [];

    // coverage component
    let coverage = 0;
    if (questionCount === 0) {
      coverage = 1;
      reasons.push("no questions target this yet");
    } else if (questionCount === 1) {
      coverage = 0.4;
      reasons.push("only one question covers this");
    }

    // recall component
    let recall = 0;
    if (cards.length === 0) {
      recall = 0.4;
      reasons.push("no flashcards for it");
    } else if (rated.length === 0) {
      recall = 0.7;
      reasons.push("flashcards not practised yet");
    } else if (avg !== null && avg < 3.5) {
      recall = (3.5 - avg) / 2.5; // 0..1
      reasons.push(`low practice confidence (avg ${avg.toFixed(1)}/5)`);
    }

    const weight = req.priority === "must" ? 1.6 : 1;
    const score = Number(((coverage + recall) * weight).toFixed(3));

    return {
      requirementId: req.id,
      text: req.text,
      priority: req.priority,
      kind: req.kind,
      questionCount,
      flashcardCount: cards.length,
      flashcardsRated: rated.length,
      averageConfidence: avg,
      scheduledDays: (scheduledQ.get(req.id) ?? []).sort((a, b) => a - b),
      score,
      reasons,
    };
  });

  return spots.sort((a, b) => b.score - a.score || (a.priority === "must" ? -1 : 1));
}
