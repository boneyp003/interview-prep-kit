"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Field, Input, Textarea } from "@/components/ui";

interface Pair {
  jd: string;
  companyUrl: string;
  days: number;
}

export function CreateKitForm({ onCreated }: { onCreated: () => void }) {
  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batchInfo, setBatchInfo] = useState<string | null>(null);

  async function submitOne(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/kits", { jd: jd.trim(), companyUrl: companyUrl.trim(), days });
      setJd("");
      setCompanyUrl("");
      onCreated();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBatchInfo(null);
    try {
      const cases = normalisePairs(JSON.parse(await file.text()));
      if (cases.length === 0) throw new Error("No valid rows found in the file");
      setBusy(true);
      const { results } = await api.post<{ results: Array<{ deduped: boolean }> }>("/kits/batch", { cases });
      const created = results.filter((r) => !r.deduped).length;
      setBatchInfo(`Queued ${created} new kit${created === 1 ? "" : "s"} (${results.length - created} already existed).`);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submitOne} className="space-y-4">
      <Field label="Job description" hint="Paste the posting text. Job-board links are not fetched.">
        <Textarea rows={6} required value={jd} onChange={(e) => setJd(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field label="Company website">
          <Input
            type="url"
            required
            placeholder="https://example.com"
            value={companyUrl}
            onChange={(e) => setCompanyUrl(e.target.value)}
          />
        </Field>
        <Field label="Days until interview">
          <Input
            type="number"
            min={1}
            max={60}
            required
            value={days}
            onChange={(e) => setDays(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
            className="w-28"
          />
        </Field>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {batchInfo && <p className="text-sm text-green-700 dark:text-green-300">{batchInfo}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Working…" : "Generate kit"}
        </Button>
        <label className="cursor-pointer text-sm underline">
          Upload a file of description/company pairs
          <input type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
        </label>
      </div>
      <p className="text-xs text-black/50 dark:text-white/50">
        File format: a JSON array of {"{ jd, company_url, days }"} objects.
      </p>
    </form>
  );
}

function normalisePairs(raw: unknown): Pair[] {
  if (!Array.isArray(raw)) throw new Error("Expected a JSON array");
  return raw
    .map((row): Pair | null => {
      if (typeof row !== "object" || row === null) return null;
      const r = row as Record<string, unknown>;
      const jd = String(r.jd ?? r.job_description ?? "").trim();
      const companyUrl = String(r.company_url ?? r.companyUrl ?? "").trim();
      const days = Number(r.days ?? 5);
      if (!jd || !companyUrl || !Number.isFinite(days)) return null;
      return { jd, companyUrl, days: Math.max(1, Math.min(60, Math.round(days))) };
    })
    .filter((x): x is Pair => x !== null);
}

function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = (err.details as { issues?: Array<{ path: string; message: string }> } | undefined)?.issues;
    if (issues?.length) return issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}
