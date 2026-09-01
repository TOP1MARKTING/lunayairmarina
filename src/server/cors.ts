/**
 * CORS for cross-origin static cPanel frontends calling Vercel server functions.
 * Origins are explicit — never use `*`.
 */

const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.lunayairmarina.com",
  "https://lunayairmarina.com",
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
export function getAllowedCorsOrigins(): string[] {
  const extra = (process.env.ALLOWED_CORS_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra])];
}

export function isServerFnPath(pathname: string): boolean {
  return pathname.startsWith("/_serverFn/");
}

export function resolveCorsOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin")?.trim();
  if (!origin) return null;
  return getAllowedCorsOrigins().includes(origin) ? origin : null;
}

export function applyCorsHeaders(request: Request, response: Response): Response {
  const allowedOrigin = resolveCorsOrigin(request);
  if (!allowedOrigin) return response;

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", allowedOrigin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.append("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function corsPreflightResponse(request: Request): Response | null {
  const allowedOrigin = resolveCorsOrigin(request);
  if (!allowedOrigin) {
    return new Response(null, { status: 403 });
  }

  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", allowedOrigin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "content-type, authorization, accept, x-tsr-serverfn",
  );
  headers.set("Access-Control-Max-Age", "86400");
  headers.append("Vary", "Origin");
  return new Response(null, { status: 204, headers });
}
