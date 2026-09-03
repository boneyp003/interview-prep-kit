"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import type { Kit } from "@ipk/core";
import { Button, Card, Spinner } from "@/components/ui";

interface SessionCard {
  card: Kit["flashcards"][number];
  record: { lastConfidence: number; reviews: number } | null;
  due: boolean;
}
interface Summary {
  total: number;
  reviewed: number;
  due: number;
  byConfidence: Record<string, number>;
  practisedRequirementIds: string[];
  unpractisedRequirementIds: string[];
}

const RATINGS = [
  { value: 1, label: "Blank" },
  { value: 2, label: "Hard" },
  { value: 3, label: "OK" },
  { value: 4, label: "Good" },
  { value: 5, label: "Easy" },
];

export default function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading, user } = useRequireAuth();
  const [cards, setCards] = useState<SessionCard[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const loadSession = useCallback(async () => {
    const res = await api.get<{ cards: SessionCard[]; summary: Summary }>(`/kits/${id}/practice/next?limit=50`);
    setCards(res.cards);
    setSummary(res.summary);
    setPos(0);
    setRevealed(false);
  }, [id]);

  useEffect(() => {
    if (user) void loadSession();
  }, [user, loadSession]);

  if (authLoading || !user || !cards) return <Spinner label="Loading practice…" />;

  const current = cards[pos];

  async function rate(confidence: number) {
    if (!current) return;
    const { summary } = await api.post<{ summary: Summary }>(`/kits/${id}/practice/${current.card.id}`, { confidence });
    setSummary(summary);
    if (pos + 1 < cards!.length) {
      setPos(pos + 1);
      setRevealed(false);
    } else {
      await loadSession();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href={`/kits/${id}`} className="text-sm underline">
          ← Back to kit
        </Link>
        <button onClick={() => void loadSession()} className="text-sm underline">
          Restart session
        </button>
      </div>

      {summary && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-black/60 dark:text-white/60">
          <span>
            {summary.reviewed}/{summary.total} cards seen
          </span>
          <span>{summary.due} due</span>
          <span>
            confidence:{" "}
            {[1, 2, 3, 4, 5].map((n) => `${n}★×${summary.byConfidence[String(n)] ?? 0}`).join("  ")}
          </span>
          {summary.unpractisedRequirementIds.length > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              not yet practised: {summary.unpractisedRequirementIds.join(", ")}
            </span>
          )}
        </div>
      )}

      {!current ? (
        <Card>
          <p>No flashcards in this kit yet. Add some from the builder.</p>
        </Card>
      ) : (
        <Card className="space-y-5 py-8 text-center">
          <p className="text-xs text-black/50 dark:text-white/50">
            Card {pos + 1} of {cards.length}
            {current.record ? ` · last rated ${current.record.lastConfidence}★` : " · new"}
          </p>
          <p className="text-lg font-medium">{current.card.front}</p>

          {revealed ? (
            <>
              <p className="whitespace-pre-wrap text-black/80 dark:text-white/80">{current.card.back}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {RATINGS.map((r) => (
                  <Button key={r.value} variant="ghost" onClick={() => void rate(r.value)}>
                    {r.value}★ {r.label}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <Button onClick={() => setRevealed(true)}>Show answer</Button>
          )}
        </Card>
      )}
    </div>
  );
}
