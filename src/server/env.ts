/**
 * Read server-only environment variables at runtime.
 * Bracket access avoids bundlers inlining missing secrets as empty strings during
 * Vercel builds when encrypted env vars are not present at build time.
 */
export function readServerEnv(name: string): string {
  const raw = process.env[name];
  return typeof raw === "string" ? raw.trim() : "";
}

export function isServerEnvConfigured(name: string): boolean {
  return readServerEnv(name).length > 0;
}
