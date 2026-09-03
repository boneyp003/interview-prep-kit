"use client";

import { use } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/auth";
import { useKit } from "@/lib/useKit";
import { api } from "@/lib/api";
import { Button, Spinner } from "@/components/ui";
import { GenerationProgress } from "@/components/GenerationProgress";
import { KitBuilder } from "@/components/KitBuilder";

export default function KitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading, user } = useRequireAuth();
  const { kit, loading, error, progress, mutate, reload } = useKit(id);

  if (authLoading || !user) return <Spinner label="Loading…" />;
  if (loading) return <Spinner label="Loading kit…" />;
  if (error && !kit) return <p className="text-red-600 dark:text-red-400">{error}</p>;
  if (!kit) return <p>Kit not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/kits" className="text-sm underline">
          ← All kits
        </Link>
        {kit.status === "ready" && (
          <Link href={`/kits/${id}/practice`}>
            <Button>Practice mode</Button>
          </Link>
        )}
      </div>

      {(kit.status === "queued" || kit.status === "running") && (
        <GenerationProgress progress={progress} />
      )}

      {kit.status === "failed" && (
        <div className="space-y-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4">
          <p className="font-medium text-red-700 dark:text-red-300">Generation failed</p>
          {kit.error && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {kit.error.code}: {kit.error.message}
            </p>
          )}
          <Button
            variant="ghost"
            onClick={async () => {
              await api.post(`/kits/${id}/retry`);
              reload();
            }}
          >
            Retry generation
          </Button>
        </div>
      )}

      {kit.status === "ready" && kit.kit && (
        <>
          {error && (
            <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <KitBuilder kitId={id} record={kit} mutate={mutate} />
        </>
      )}
    </div>
  );
}
