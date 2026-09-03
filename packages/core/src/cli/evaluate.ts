import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadCoreConfig } from "../config/index.js";
import { casesFileSchema, type CaseInput } from "../schema/batch.js";
import { runBatch } from "./batch.js";

/**
 * Section 9 batch entry point:
 *   npm run evaluate -- --input <cases.json> --output <kits.json>
 *
 * Thin shell: parse args, load env + cases, delegate to runBatch (the same
 * pipeline the app uses), write one Appendix B file. Runs from a clean clone
 * with only the env vars documented in .env.example.
 *
 * Company sites in these cases are frequently served from localhost, so
 * private-address blocking is OFF by default here (it stays on in the app).
 */

async function main(): Promise<void> {
  const args = parseCli();
  loadEnv(args.envPath);

  const config = loadCoreConfig();
  if (!config.gemini.apiKey) {
    fail("GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.");
  }

  const cases = await readCases(args.input);
  log(`Loaded ${cases.length} case(s) from ${args.input}`);

  const started = Date.now();
  const output = await runBatch(cases, {
    config,
    concurrency: args.concurrency,
    caseTimeoutMs: args.caseTimeoutMs,
    allowPrivateAddresses: !args.blockPrivate,
    onLog: log,
    verbose: args.verbose,
  });

  await mkdir(dirname(resolve(args.output)), { recursive: true });
  await writeFile(resolve(args.output), JSON.stringify(output, null, 2) + "\n", "utf8");

  const ok = output.kits.filter((k) => k.status === "ok").length;
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  log(`Wrote ${output.kits.length} result(s) to ${args.output} — ${ok} ok, ${output.kits.length - ok} failed, ${elapsed}s`);
}

interface CliArgs {
  input: string;
  output: string;
  concurrency: number;
  caseTimeoutMs: number;
  blockPrivate: boolean;
  verbose: boolean;
  envPath?: string;
}

function parseCli(): CliArgs {
  const parsed = safeParseArgs();
  const { values } = parsed;

  if (values.help || !values.input || !values.output) {
    log(
      "Usage: npm run evaluate -- --input <cases.json> --output <kits.json>\n" +
        "  --concurrency <n>      cases to run at once (default 3)\n" +
        "  --case-timeout <secs>  per-case hard limit (default 240)\n" +
        "  --block-private        reject private/loopback company URLs (default: allowed, for local fixtures)\n" +
        "  --env-path <path>      environment file to load (default .env)",
    );
    process.exit(values.help ? 0 : 2);
  }

  const concurrency = values.concurrency ? Number(values.concurrency) : 3;
  const caseTimeout = values["case-timeout"] ? Number(values["case-timeout"]) : 240;
  if (!Number.isInteger(concurrency) || concurrency < 1) fail("--concurrency must be a positive integer");
  if (!Number.isFinite(caseTimeout) || caseTimeout < 1) fail("--case-timeout must be a positive number of seconds");

  return {
    input: values.input,
    output: values.output,
    concurrency,
    caseTimeoutMs: caseTimeout * 1000,
    blockPrivate: values["block-private"] ?? false,
    verbose: values.verbose ?? false,
    ...(values["env-path"] ? { envPath: values["env-path"] } : {}),
  };
}

function safeParseArgs() {
  try {
    return parseArgs({
      options: {
        input: { type: "string", short: "i" },
        output: { type: "string", short: "o" },
        concurrency: { type: "string" },
        "case-timeout": { type: "string" },
        "block-private": { type: "boolean", default: false },
        "env-path": { type: "string" },
        verbose: { type: "boolean", short: "v", default: false },
        help: { type: "boolean", default: false },
      },
      allowPositionals: false,
    });
  } catch (err) {
    fail((err as Error).message);
  }
}

async function readCases(path: string): Promise<CaseInput[]> {
  const raw = await readFile(resolve(path), "utf8").catch(() => fail(`Cannot read input file: ${path}`));
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    fail(`Input file is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = casesFileSchema.safeParse(json);
  if (!parsed.success) {
    fail(
      "Input file must be an array of {id, jd, company_url, days}:\n" +
        parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n"),
    );
  }
  const seen = new Set<string>();
  for (const c of parsed.data) {
    if (seen.has(c.id)) fail(`Duplicate case id: ${c.id}`);
    seen.add(c.id);
  }
  return parsed.data;
}

function loadEnv(envPath?: string): void {
  try {
    (process as unknown as { loadEnvFile: (p?: string) => void }).loadEnvFile(envPath);
  } catch {
    if (envPath) log(`Note: could not load ${envPath}; using the existing process environment.`);
  }
}

function log(message: string): void {
  process.stderr.write(message + "\n");
}

function fail(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
