"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { KitRecord, ProgressResponse } from "./types";

interface State {
  kit: KitRecord | null;
  loading: boolean;
  error: string | null;
  progress: ProgressResponse | null;
}

/**
 * Loads a kit, polls generation progress while it is queued/running, and
 * exposes a `mutate` helper: every builder call returns the full updated kit,
 * so we just replace local state with the server's authority — no optimistic
 * divergence, and edits elsewhere are never clobbered.
 */
export function useKit(id: string) {
  const [state, setState] = useState<State>({ kit: null, loading: true, error: null, progress: null });
  const busyRef = useRef(false);

  const loadKit = useCallback(async () => {
    try {
      const { kit } = await api.get<{ kit: KitRecord }>(`/kits/${id}`);
      setState((s) => ({ ...s, kit, loading: false, error: null }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof ApiError ? err.message : "Failed to load kit",
      }));
    }
  }, [id]);

  useEffect(() => {
    void loadKit();
  }, [loadKit]);

  // Poll progress while generating.
  useEffect(() => {
    const status = state.kit?.status;
    if (status !== "queued" && status !== "running") return;
    let active = true;
    const tick = async () => {
      try {
        const progress = await api.get<ProgressResponse>(`/kits/${id}/progress`);
        if (!active) return;
        setState((s) => ({ ...s, progress }));
        if (progress.status === "ready" || progress.status === "failed") await loadKit();
      } catch {
        /* keep polling */
      }
    };
    void tick();
    const t = setInterval(tick, 2000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [state.kit?.status, id, loadKit]);

  /** Run a builder request; replace local kit with the server's response. */
  const mutate = useCallback(async <T extends { kit: KitRecord }>(run: () => Promise<T>): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setState((s) => ({ ...s, error: null }));
    try {
      const { kit } = await run();
      setState((s) => ({ ...s, kit }));
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof ApiError ? errText(err) : "That change did not go through",
      }));
      // Re-sync in case the server rejected mid-way.
      await loadKit();
    } finally {
      busyRef.current = false;
    }
  }, [loadKit]);

  return { ...state, reload: loadKit, mutate };
}

function errText(err: ApiError): string {
  const issues = (err.details as { issues?: Array<{ path?: string; message: string }> } | undefined)?.issues;
  if (issues?.length) return issues.map((i) => (i.path ? `${i.path}: ` : "") + i.message).join("; ");
  return err.message;
}
