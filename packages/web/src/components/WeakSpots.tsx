"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Card, Spinner } from "@/components/ui";

interface WeakSpot {
  requirementId: string;
  text: string;
  priority: "must" | "nice";
  questionCount: number;
  flashcardCount: number;
  flashcardsRated: number;
  averageConfidence: number | null;
  scheduledDays: number[];
  score: number;
  reasons: string[];
}

/**
 * Optional feature. Pulls coverage + practice confidence + schedule position
 * into one ranked "focus here next" list — the thing a candidate with a full
 * kit and limited time actually needs.
 */
export function WeakSpots({ kitId }: { kitId: string }) {
  const [spots, setSpots] = useState<WeakSpot[] | null>(null);

  useEffect(() => {
    void api.get<{ weakSpots: WeakSpot[] }>(`/kits/${kitId}/weak-spots`).then((r) => setSpots(r.weakSpots));
  }, [kitId]);

  if (!spots) return <Spinner label="Analysing…" />;
  const ranked = spots.filter((s) => s.score > 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-black/60 dark:text-white/60">
        Ranked by how much attention each requirement still needs — thin question coverage, low
        flashcard confidence, or not yet practised. Must-haves are weighted heavier.
      </p>
      {ranked.length === 0 ? (
        <Card>
          <p className="text-sm">
            Nothing stands out — every requirement has questions and your practice confidence is
            solid. Keep going.
          </p>
        </Card>
      ) : (
        <ol className="space-y-2">
          {ranked.map((s) => (
            <li key={s.requirementId}>
              <Card className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-black/10 px-1 text-xs dark:bg-white/10">{s.requirementId}</code>
                  {s.priority === "must" && <Badge tone="red">must</Badge>}
                  <span className="font-medium">{s.text}</span>
                  <span className="ml-auto text-xs text-black/50 dark:text-white/50">score {s.score}</span>
                </div>
                <p className="text-sm text-black/70 dark:text-white/70">{s.reasons.join(" · ")}</p>
                <p className="text-xs text-black/50 dark:text-white/50">
                  {s.questionCount} question{s.questionCount === 1 ? "" : "s"} ·{" "}
                  {s.flashcardsRated}/{s.flashcardCount} flashcards practised
                  {s.averageConfidence !== null && ` · avg ${s.averageConfidence.toFixed(1)}★`}
                  {s.scheduledDays.length > 0 && ` · scheduled day ${s.scheduledDays.join(", ")}`}
                </p>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
