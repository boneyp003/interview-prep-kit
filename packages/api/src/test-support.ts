import { MongoMemoryServer } from "mongodb-memory-server";
import { loadApiConfig, type ApiConfig } from "./config.js";
import { connectDb, disconnectDb } from "./db/connect.js";
import { KitModel } from "./db/models/kit.js";
import { User } from "./db/models/user.js";
import { setGenerationTrigger, resetGenerationTrigger } from "./jobs/index.js";

let mongo: MongoMemoryServer | undefined;

/** Spin up an in-memory Mongo and a config wired to it. */
export async function setupTestEnv(): Promise<ApiConfig> {
  mongo = await MongoMemoryServer.create();
  const config = loadApiConfig({
    NODE_ENV: "test",
    AUTH_SECRET: "test-secret-0123456789",
    MONGODB_URI: mongo.getUri(),
    GEMINI_API_KEY: "test",
  });
  await connectDb(config.mongoUri);

  // Never touch the real pipeline in API tests: mark the kit ready with a
  // minimal valid kit so builder/practice paths have something to act on.
  setGenerationTrigger(async (kitId) => {
    await KitModel.updateOne(
      { _id: kitId },
      {
        $set: {
          status: "ready",
          kit: fakeKit(),
          itemState: { q1: gen(), q2: gen(), f1: gen() },
          warnings: [],
          error: null,
        },
      },
    );
  });

  return config;
}

export async function teardownTestEnv(): Promise<void> {
  resetGenerationTrigger();
  await disconnectDb();
  await mongo?.stop();
}

export async function clearDb(): Promise<void> {
  await Promise.all([KitModel.deleteMany({}), User.deleteMany({})]);
}

function gen() {
  return { origin: "generated", edited: false, pinned: false, updatedAt: new Date().toISOString() };
}

function fakeKit() {
  return {
    source: {
      company: "Acme", company_url: "https://acme.example/", role: "Engineer", location: "remote",
      jd_chars: 100, pages_used: ["https://acme.example/"], researched_at: new Date().toISOString(),
    },
    company_brief: { summary: "Acme.", what_they_do: "Software.", sources: ["https://acme.example/"] },
    role: {
      title: "Engineer", seniority: "mid", responsibilities: ["Ship"],
      requirements: [{ id: "r1", text: "TypeScript", kind: "technical", priority: "must" }],
    },
    questions: [
      { id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "TS generics?", answer_outline: "...", difficulty: 2 },
      { id: "q2", requirement_ids: ["r1"], category: "behavioural", prompt: "A conflict?", answer_outline: "...", difficulty: 1 },
    ],
    flashcards: [{ id: "f1", front: "TS?", back: "Typed JS.", requirement_ids: ["r1"] }],
    schedule: {
      days_available: 3,
      days: [
        { day: 1, focus: "TypeScript", question_ids: ["q1"], minutes: 30 },
        { day: 2, focus: "Behavioural", question_ids: ["q2"], minutes: 20 },
        { day: 3, focus: "Review", question_ids: ["q1", "q2"], minutes: 40 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}
