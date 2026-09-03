/**
 * @ipk/core — framework-free pipeline library.
 *
 * Every consumer (the Express API, the `npm run evaluate` CLI, and the tests)
 * imports from here. Nothing in this package may import Express, Next, or touch
 * `process.argv` / HTTP request objects.
 *
 * Concerns (each its own directory):
 *   schema      Appendix A / B contracts + validation
 *   retrieval   SSRF-guarded fetch, robots, crawl, link ranking, web search
 *   extraction  JD -> requirements (LLM)
 *   generation  company brief + questions per (requirement, category) (LLM)
 *   scheduling  deterministic day allocation
 *   coverage    deterministic gap check + second-pass loop
 *   pipeline    runPipeline() orchestrator + progress events
 *   builder     generated / edited / pinned state, merge-on-regenerate
 */
export * from "./schema/index.js";
export { loadCoreConfig, type CoreConfig } from "./config/index.js";
export * from "./pipeline/index.js";
export { createRetrieval } from "./retrieval/index.js";
export { createLlm, LlmClient, LlmError } from "./generation/llm/index.js";
export { checkCoverage } from "./coverage/index.js";
export { buildSchedule } from "./scheduling/index.js";
