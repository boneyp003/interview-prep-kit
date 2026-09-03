"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { KitRecord } from "@/lib/types";
import type { Kit } from "@ipk/core";
import { Badge, Button, Card } from "@/components/ui";
import { InlineEdit } from "@/components/InlineEdit";

type Mutate = <T extends { kit: KitRecord }>(run: () => Promise<T>) => Promise<void>;

const CATEGORIES = ["technical", "behavioural", "system-design", "company-fit"] as const;
const KINDS = ["technical", "behavioural", "domain"] as const;

type KitResp = { kit: KitRecord };
const k = {
  patch: (path: string, body: unknown) => api.patch<KitResp>(path, body),
  post: (path: string, body?: unknown) => api.post<KitResp>(path, body),
  put: (path: string, body: unknown) => api.put<KitResp>(path, body),
  del: (path: string) => api.del<KitResp>(path),
};

export function KitBuilder({ kitId, record, mutate }: { kitId: string; record: KitRecord; mutate: Mutate }) {
  const kit = record.kit as Kit;
  const base = `/kits/${kitId}`;
  const reqText = useMemo(
    () => new Map(kit.role.requirements.map((r) => [r.id, r.text])),
    [kit.role.requirements],
  );

  return (
    <div className="space-y-10">
      <SourceStrip kit={kit} />
      <CoverageBanner kit={kit} />

      {/* ── Company brief ─────────────────────────────────────────── */}
      <Section
        title="Company brief"
        edited={record.sectionState.companyBrief.edited}
        onRegenerate={() => mutate(() => k.post(`${base}/regenerate`, { section: "brief" }))}
      >
        <Card className="space-y-3">
          <Labelled label="Summary">
            <InlineEdit
              multiline
              value={kit.company_brief.summary}
              label="summary"
              onSave={(v) => mutate(() => k.patch(`${base}/brief`, { summary: v }))}
            />
          </Labelled>
          <Labelled label="What they do">
            <InlineEdit
              multiline
              value={kit.company_brief.what_they_do}
              label="what they do"
              onSave={(v) => mutate(() => k.patch(`${base}/brief`, { what_they_do: v }))}
            />
          </Labelled>
          {kit.company_brief.sources.length > 0 && (
            <p className="text-xs text-black/50 dark:text-white/50">
              Sources: {kit.company_brief.sources.map((s, i) => (
                <a key={s} href={s} target="_blank" rel="noreferrer" className="underline">
                  {i > 0 ? ", " : ""}
                  {hostOf(s)}
                </a>
              ))}
            </p>
          )}
        </Card>
      </Section>

      {/* ── Role ─────────────────────────────────────────────────── */}
      <Section title="Role">
        <Card className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Labelled label="Title">
              <InlineEdit value={kit.role.title} onSave={(v) => mutate(() => k.patch(`${base}/role`, { title: v }))} />
            </Labelled>
            <Labelled label="Seniority">
              <InlineEdit value={kit.role.seniority} onSave={(v) => mutate(() => k.patch(`${base}/role`, { seniority: v }))} />
            </Labelled>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
              Requirements
            </p>
            <ul className="space-y-2">
              {kit.role.requirements.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <code className="rounded bg-black/10 px-1 text-xs dark:bg-white/10">{r.id}</code>
                  <select
                    value={r.priority}
                    onChange={(e) =>
                      mutate(() =>
                        k.patch(`${base}/role`, {
                          requirements: kit.role.requirements.map((x) =>
                            x.id === r.id ? { ...x, priority: e.target.value } : x,
                          ),
                        }),
                      )
                    }
                    className="rounded border border-black/15 bg-transparent px-1 py-0.5 text-xs dark:border-white/15"
                  >
                    <option value="must">must</option>
                    <option value="nice">nice</option>
                  </select>
                  <select
                    value={r.kind}
                    onChange={(e) =>
                      mutate(() =>
                        k.patch(`${base}/role`, {
                          requirements: kit.role.requirements.map((x) =>
                            x.id === r.id ? { ...x, kind: e.target.value } : x,
                          ),
                        }),
                      )
                    }
                    className="rounded border border-black/15 bg-transparent px-1 py-0.5 text-xs dark:border-white/15"
                  >
                    {KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                  <span className="min-w-[12rem] flex-1">
                    <InlineEdit
                      value={r.text}
                      onSave={(v) =>
                        mutate(() =>
                          k.patch(`${base}/role`, {
                            requirements: kit.role.requirements.map((x) =>
                              x.id === r.id ? { ...x, text: v } : x,
                            ),
                          }),
                        )
                      }
                    />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </Section>

      {/* ── Questions ────────────────────────────────────────────── */}
      <Section title="Question bank">
        <div className="space-y-6">
          {CATEGORIES.map((category) => {
            const inCat = kit.questions.filter((q) => q.category === category);
            return (
              <div key={category}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-medium capitalize">{category.replace("-", " ")} ({inCat.length})</h3>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        mutate(() =>
                          k.post(`${base}/questions`, {
                            category,
                            requirement_ids: [kit.role.requirements[0]?.id].filter(Boolean),
                            prompt: "New question",
                            answer_outline: "",
                          }),
                        )
                      }
                    >
                      + Add
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => mutate(() => k.post(`${base}/regenerate`, { section: "questions", category }))}
                    >
                      Regenerate
                    </Button>
                  </div>
                </div>
                <ul className="space-y-3">
                  {inCat.map((q, i) => (
                    <li key={q.id}>
                      <QuestionCard
                        base={base}
                        mutate={mutate}
                        kit={kit}
                        q={q}
                        origin={record.itemState[q.id]?.origin ?? "generated"}
                        edited={record.itemState[q.id]?.edited ?? false}
                        pinned={record.itemState[q.id]?.pinned ?? false}
                        canUp={i > 0}
                        canDown={i < inCat.length - 1}
                        onMove={(dir) => moveWithin(kit, q.id, inCat, dir, base, mutate)}
                      />
                    </li>
                  ))}
                  {inCat.length === 0 && (
                    <li className="text-sm text-black/50 dark:text-white/50">No questions in this category.</li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── Flashcards ───────────────────────────────────────────── */}
      <Section title="Flashcards">
        <div className="space-y-3">
          <Button
            variant="ghost"
            onClick={() =>
              mutate(() =>
                k.post(`${base}/flashcards`, {
                  front: "New card",
                  back: "",
                  requirement_ids: [kit.role.requirements[0]?.id].filter(Boolean),
                }),
              )
            }
          >
            + Add flashcard
          </Button>
          <ul className="grid gap-3 sm:grid-cols-2">
            {kit.flashcards.map((f) => (
              <li key={f.id}>
                <Card className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs text-black/50 dark:text-white/50">
                      {f.requirement_ids.map((id) => reqText.get(id) ?? id).join(", ")}
                    </span>
                    <button
                      onClick={() => mutate(() => k.del(`${base}/flashcards/${f.id}`))}
                      className="text-xs text-red-600 hover:underline dark:text-red-400"
                    >
                      delete
                    </button>
                  </div>
                  <InlineEdit
                    value={f.front}
                    className="font-medium"
                    onSave={(v) => mutate(() => k.patch(`${base}/flashcards/${f.id}`, { front: v }))}
                  />
                  <InlineEdit
                    multiline
                    value={f.back}
                    placeholder="Answer…"
                    onSave={(v) => mutate(() => k.patch(`${base}/flashcards/${f.id}`, { back: v }))}
                  />
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* ── Schedule ─────────────────────────────────────────────── */}
      <Section
        title={`Study schedule · ${kit.schedule.days_available} days`}
        edited={record.sectionState.schedule.edited}
        onRegenerate={() => mutate(() => k.post(`${base}/regenerate`, { section: "schedule" }))}
      >
        <ol className="space-y-3">
          {kit.schedule.days.map((day) => (
            <li key={day.day}>
              <Card className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Day {day.day}</span>
                  <span className="text-sm text-black/50 dark:text-white/50">{day.minutes} min</span>
                </div>
                <InlineEdit
                  value={day.focus}
                  placeholder="Focus…"
                  onSave={(v) =>
                    mutate(() =>
                      k.patch(`${base}/schedule`, {
                        days: kit.schedule.days.map((d) => (d.day === day.day ? { ...d, focus: v } : d)),
                      }),
                    )
                  }
                />
                <ul className="list-disc pl-5 text-sm text-black/70 dark:text-white/70">
                  {day.question_ids.map((qid) => {
                    const q = kit.questions.find((x) => x.id === qid);
                    return <li key={qid}>{q ? q.prompt : <span className="text-red-500">missing {qid}</span>}</li>;
                  })}
                  {day.question_ids.length === 0 && <li className="list-none text-black/40">Review / rest</li>}
                </ul>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      {record.warnings.length > 0 && (
        <details className="text-sm text-black/60 dark:text-white/60">
          <summary>Research notes ({record.warnings.length})</summary>
          <ul className="mt-2 list-disc pl-5">
            {record.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function QuestionCard({
  base,
  mutate,
  kit,
  q,
  origin,
  edited,
  pinned,
  canUp,
  canDown,
  onMove,
}: {
  base: string;
  mutate: Mutate;
  kit: Kit;
  q: Kit["questions"][number];
  origin: string;
  edited: boolean;
  pinned: boolean;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <code className="rounded bg-black/10 px-1 dark:bg-white/10">{q.id}</code>
        {origin === "user" && <Badge tone="blue">yours</Badge>}
        {edited && <Badge tone="amber">edited</Badge>}
        {pinned && <Badge tone="green">pinned</Badge>}
        <span className="text-black/50 dark:text-white/50">
          covers {q.requirement_ids.join(", ") || "—"}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <button disabled={!canUp} onClick={() => onMove(-1)} className="disabled:opacity-30" aria-label="Move up">
            ↑
          </button>
          <button disabled={!canDown} onClick={() => onMove(1)} className="disabled:opacity-30" aria-label="Move down">
            ↓
          </button>
        </span>
      </div>

      <InlineEdit
        value={q.prompt}
        className="font-medium"
        label="question"
        onSave={(v) => mutate(() => k.patch(`${base}/questions/${q.id}`, { prompt: v }))}
      />
      <InlineEdit
        multiline
        value={q.answer_outline}
        placeholder="Answer outline…"
        label="answer outline"
        onSave={(v) => mutate(() => k.patch(`${base}/questions/${q.id}`, { answer_outline: v }))}
      />

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          difficulty
          <select
            value={q.difficulty}
            onChange={(e) =>
              mutate(() => k.patch(`${base}/questions/${q.id}`, { difficulty: Number(e.target.value) }))
            }
            className="rounded border border-black/15 bg-transparent px-1 dark:border-white/15"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          category
          <select
            value={q.category}
            onChange={(e) => mutate(() => k.patch(`${base}/questions/${q.id}`, { category: e.target.value }))}
            className="rounded border border-black/15 bg-transparent px-1 dark:border-white/15"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          covers
          <select
            multiple
            value={q.requirement_ids}
            onChange={(e) =>
              mutate(() =>
                k.patch(`${base}/questions/${q.id}`, {
                  requirement_ids: Array.from(e.target.selectedOptions, (o) => o.value),
                }),
              )
            }
            className="rounded border border-black/15 bg-transparent px-1 dark:border-white/15"
          >
            {kit.role.requirements.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => mutate(() => k.post(`${base}/questions/${q.id}/pin`, { pinned: !pinned }))}
          className="underline"
        >
          {pinned ? "unpin" : "pin"}
        </button>
        <button
          onClick={() => mutate(() => k.del(`${base}/questions/${q.id}`))}
          className="text-red-600 underline dark:text-red-400"
        >
          delete
        </button>
      </div>
    </Card>
  );
}

function moveWithin(
  kit: Kit,
  id: string,
  inCat: Kit["questions"],
  dir: -1 | 1,
  base: string,
  mutate: Mutate,
) {
  const pos = inCat.findIndex((q) => q.id === id);
  const swapWith = inCat[pos + dir];
  if (!swapWith) return;
  const order = kit.questions.map((q) => q.id);
  const a = order.indexOf(id);
  const b = order.indexOf(swapWith.id);
  [order[a], order[b]] = [order[b]!, order[a]!];
  void mutate(() => k.put(`${base}/questions/order`, { order }));
}

function Section({
  title,
  edited,
  onRegenerate,
  children,
}: {
  title: string;
  edited?: boolean;
  onRegenerate?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {title} {edited && <Badge tone="amber">edited</Badge>}
        </h2>
        {onRegenerate && (
          <Button variant="ghost" onClick={onRegenerate}>
            Regenerate
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
        {label}
      </p>
      {children}
    </div>
  );
}

function SourceStrip({ kit }: { kit: Kit }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-black/50 dark:text-white/50">
      <span>{kit.source.company}</span>
      <a href={kit.source.company_url} target="_blank" rel="noreferrer" className="underline">
        {kit.source.company_url}
      </a>
      <span>{kit.source.jd_chars} chars of JD</span>
      <span>{kit.source.pages_used.length} pages used</span>
      <span>researched {new Date(kit.source.researched_at).toLocaleDateString()}</span>
    </div>
  );
}

function CoverageBanner({ kit }: { kit: Kit }) {
  const uncovered = kit.coverage.uncovered_requirement_ids;
  const musts = new Set(kit.role.requirements.filter((r) => r.priority === "must").map((r) => r.id));
  const uncoveredMust = uncovered.filter((id) => musts.has(id));
  if (uncovered.length === 0) {
    return (
      <div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">
        Every requirement has at least one question · {kit.coverage.passes} coverage pass(es)
      </div>
    );
  }
  return (
    <div className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
      {uncoveredMust.length > 0
        ? `${uncoveredMust.length} must-have requirement(s) still uncovered: ${uncoveredMust.join(", ")}. `
        : ""}
      {uncovered.length - uncoveredMust.length > 0 &&
        `${uncovered.length - uncoveredMust.length} nice-to-have(s) uncovered. `}
      Regenerate a category or add a question to close the gap.
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
