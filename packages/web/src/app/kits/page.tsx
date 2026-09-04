"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import type { KitSummary } from "@/lib/types";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import { CreateKitForm } from "@/components/CreateKitForm";

const STATUS_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
  queued: "neutral",
  running: "blue",
  ready: "green",
  failed: "red",
};

export default function KitsPage() {
  const { loading: authLoading, user } = useRequireAuth();
  const [kits, setKits] = useState<KitSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { kits } = await api.get<{ kits: KitSummary[] }>("/kits");
      setKits(kits);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(err instanceof Error ? err.message : "Failed to load kits");
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void refresh();
  }, [user, refresh]);

  // Poll while anything is still generating.
  useEffect(() => {
    if (!kits?.some((k) => k.status === "queued" || k.status === "running")) return;
    const t = setInterval(() => void refresh(), 2500);
    return () => clearInterval(t);
  }, [kits, refresh]);

  if (authLoading || !user) return <Spinner label="Loading…" />;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-1 text-xl font-semibold">New prep kit</h1>
        <p className="mb-4 text-sm text-black/60 dark:text-white/60">
          Paste a job description and the company website. Add more than one to prepare for
          several roles at once.
        </p>
        <CreateKitForm onCreated={refresh} />
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Your kits</h2>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!kits ? (
          <Spinner label="Loading kits…" />
        ) : kits.length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">Nothing yet — create one above.</p>
        ) : (
          <ul className="space-y-3">
            {kits.map((kit) => (
              <li key={kit.id}>
                <KitRow kit={kit} onChange={refresh} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function KitRow({ kit, onChange }: { kit: KitSummary; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm("Delete this kit?")) return;
    setBusy(true);
    try {
      await api.del(`/kits/${kit.id}`);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    try {
      await api.post(`/kits/${kit.id}/retry`);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  const inFlight = kit.status === "queued" || kit.status === "running";

  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[kit.status]}>{kit.status}</Badge>
          <span className="truncate font-medium">{kit.role || "Untitled role"}</span>
        </div>
        <p className="mt-0.5 truncate text-sm text-black/60 dark:text-white/60">
          {kit.company} · {kit.days}-day plan
          {kit.status === "ready" && ` · ${kit.questionCount} questions`}
          {kit.status === "ready" && kit.uncovered > 0 && ` · ${kit.uncovered} uncovered`}
        </p>
        {kit.status === "failed" && kit.error && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">
            {kit.error.code}: {kit.error.message}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {inFlight && (
          <>
            <Spinner label="Generating…" />
            <Link href={`/kits/${kit.id}`}>
              <Button variant="ghost">View progress</Button>
            </Link>
          </>
        )}
        {(kit.status === "ready" || kit.status === "failed") && (
          <Link href={`/kits/${kit.id}`}>
            <Button variant="ghost">Open</Button>
          </Link>
        )}
        {kit.status === "failed" && (
          <Button variant="ghost" onClick={retry} disabled={busy}>
            Retry
          </Button>
        )}
        <Button variant="danger" onClick={remove} disabled={busy || inFlight}>
          Delete
        </Button>
      </div>
    </Card>
  );
}
