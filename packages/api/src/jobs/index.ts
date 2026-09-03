import type { CoreConfig } from "@ipk/core";
import { startGeneration } from "./runner.js";

export type GenerationTrigger = (kitId: string, core: CoreConfig) => Promise<void>;

/**
 * Indirection so the generation runner can be swapped in tests (which must not
 * hit the real LLM). Production uses the in-process pipeline runner.
 */
let trigger: GenerationTrigger = startGeneration;

export function runGeneration(kitId: string, core: CoreConfig): Promise<void> {
  return trigger(kitId, core);
}

export function setGenerationTrigger(fn: GenerationTrigger): void {
  trigger = fn;
}

export function resetGenerationTrigger(): void {
  trigger = startGeneration;
}
