/**
 * Read server-only environment variables at runtime.
 * Bracket access avoids bundlers inlining missing secrets as empty strings during
 * Vercel builds when encrypted env vars are not present at build time.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

let localEnvLoaded = false;

function ensureLocalEnvLoaded(): void {
  if (localEnvLoaded || process.env.VERCEL) return;
  localEnvLoaded = true;
  const root = resolve(import.meta.dirname, "../..");
  const envPath = resolve(root, ".env");
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }
}

export function readServerEnv(name: string): string {
  ensureLocalEnvLoaded();
  const raw = process.env[name];
  return typeof raw === "string" ? raw.trim() : "";
}

export function isServerEnvConfigured(name: string): boolean {
  return readServerEnv(name).length > 0;
}
