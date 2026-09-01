/**
 * CORS for cross-origin static cPanel frontends calling Vercel server functions.
 * Origins are explicit — never use `*`.
 */

import { getTrustedOrigins, isTrustedOrigin } from "@/lib/trustedOrigins";

export { getTrustedOrigins as getAllowedCorsOrigins, isTrustedOrigin };

export function isServerFnPath(pathname: string): boolean {
  return pathname.startsWith("/_serverFn/");
}

export function resolveCorsOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin")?.trim();
  if (!origin) return null;
  return isTrustedOrigin(origin) ? origin : null;
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
