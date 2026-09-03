import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { loadApiConfig } from "./config.js";
import { connectDb } from "./db/connect.js";
import { sweepInterruptedJobs } from "./jobs/runner.js";

/** Load .env from the cwd, then walk up to the repo root (workspace layout). */
function loadEnv(): void {
  const load = (process as unknown as { loadEnvFile: (p?: string) => void }).loadEnvFile;
  for (const candidate of [".env", "../.env", "../../.env"]) {
    const path = resolve(process.cwd(), candidate);
    if (existsSync(path)) {
      try {
        load(path);
        return;
      } catch {
        /* keep looking */
      }
    }
  }
}

async function main(): Promise<void> {
  loadEnv();

  const config = loadApiConfig();

  await connectDb(config.mongoUri);
  const swept = await sweepInterruptedJobs();
  if (swept > 0) console.log(`Recovered ${swept} interrupted generation(s) as failed`);

  if (!config.core.gemini.apiKey) {
    console.warn("Warning: GEMINI_API_KEY is not set — kit generation will fail until it is.");
  }

  const app = createApp(config);
  app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start API:", err);
  process.exit(1);
});
