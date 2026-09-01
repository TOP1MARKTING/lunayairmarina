/**
 * Explicit browser origins allowed for cross-origin server-fn calls (cPanel → Vercel).
 * Shared by CORS response headers and CSRF validation — never use `*`.
 */

const DEFAULT_TRUSTED_ORIGINS = [
  "https://www.lunayairmarina.com",
  "https://lunayairmarina.com",
  "https://lunayairmarina.vercel.app",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const;

/** Merge defaults with ALLOWED_CORS_ORIGINS (comma-separated, server env only). */
export function getTrustedOrigins(): string[] {
  const extra = (process.env.ALLOWED_CORS_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_TRUSTED_ORIGINS, ...extra])];
}

export function isTrustedOrigin(origin: string): boolean {
  return getTrustedOrigins().includes(origin);
}
