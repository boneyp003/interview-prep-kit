import { loadCoreConfig, type CoreConfig } from "@ipk/core";

export interface ApiConfig {
  port: number;
  webOrigin: string[];
  authSecret: string;
  mongoUri: string;
  sessionTtlHours: number;
  core: CoreConfig;
  isProduction: boolean;
}

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const isProduction = env.NODE_ENV === "production";
  return {
    // Most free hosts (Render, Railway, Heroku-style) inject PORT and require
    // the app to bind to it; API_PORT is the override for local/manual setups.
    port: Number(env.PORT ?? env.API_PORT ?? 4000),
    webOrigin: (env.WEB_ORIGIN ?? "http://localhost:3000").split(",").map((s) => s.trim()),
    authSecret: isProduction
      ? required("AUTH_SECRET", env.AUTH_SECRET)
      : (env.AUTH_SECRET ?? "dev-only-insecure-secret-change-me"),
    mongoUri: env.MONGODB_URI ?? "mongodb://localhost:27017/interview-prep-kit",
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 24 * 7),
    core: loadCoreConfig(env),
    isProduction,
  };
}
