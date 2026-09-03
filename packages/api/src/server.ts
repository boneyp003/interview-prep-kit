import { createApp } from "./app.js";
import { loadApiConfig } from "./config.js";
import { connectDb } from "./db/connect.js";
import { sweepInterruptedJobs } from "./jobs/runner.js";

async function main(): Promise<void> {
  try {
    (process as unknown as { loadEnvFile: (p?: string) => void }).loadEnvFile();
  } catch {
    /* no .env file — rely on the process environment */
  }

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
