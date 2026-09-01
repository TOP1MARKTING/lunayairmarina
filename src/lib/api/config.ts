import type { ApiOperation } from "./endpoints";
import { FIREBASE_FUNCTION_NAMES, HTTP_API_PATHS, TANSTACK_SERVER_FUNCTION_IDS } from "./endpoints";

export type ApiTransport = "http" | "server-fn";

/**
 * Defaults to `server-fn` so SSR deployments (Vercel) call TanStack server
 * functions. The static cPanel build also uses `server-fn` against the remote
 * Vercel backend. Only emulator/legacy tooling opts into `http` (Firebase CF).
 */
export function getApiTransport(): ApiTransport {
  const raw = (import.meta.env.VITE_API_TRANSPORT as string | undefined)?.trim();
  return raw === "http" ? "http" : "server-fn";
}

export function isStaticHostingBuild(): boolean {
  return (import.meta.env.VITE_STATIC_HOSTING as string | undefined) === "true";
}

/** Static cPanel bundle calls the Vercel backend over HTTPS (cross-origin). */
export function usesRemoteServerFn(): boolean {
  return isStaticHostingBuild() && getApiTransport() === "server-fn";
}

/**
 * Public site origin (cPanel). Used for SEO, canonical URLs, and as the browser
 * `Origin` header when calling the remote API.
 */
export function getSiteOrigin(): string {
  const fromEnv = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim();
  const base = fromEnv || "https://www.lunayairmarina.com";
  return base.replace(/\/$/, "");
}

/**
 * Remote Vercel SSR/API origin. Static hosting calls server functions here.
 * Defaults to the production Vercel deployment when unset.
 */
export function getApiBaseUrl(): string {
  const fromEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  const base = fromEnv || "https://www.lunayairmarina.com";
  return base.replace(/\/$/, "");
}

/**
 * TanStack Start server-function path prefix.
 * Static builds use an absolute URL on the Vercel backend.
 */
export function getTanStackServerFnBase(): string {
  const fromEnv = (import.meta.env.VITE_TSS_SERVER_FN_BASE as string | undefined)?.trim();
  if (fromEnv) {
    return fromEnv.endsWith("/") ? fromEnv : `${fromEnv}/`;
  }
  if (isStaticHostingBuild()) {
    return `${getApiBaseUrl()}/_serverFn/`;
  }
  return "/_serverFn/";
}

/** Full URL for a remote TanStack server function (static cPanel → Vercel). */
export function getTanStackServerFnUrl(operation: ApiOperation): string {
  const base = getTanStackServerFnBase();
  const id = TANSTACK_SERVER_FUNCTION_IDS[operation];
  if (base.startsWith("http://") || base.startsWith("https://")) {
    return `${base}${id}`;
  }
  return `${getApiBaseUrl()}${base}${id}`;
}

// Re-export for tests/tooling that import from config.ts
export { FIREBASE_FUNCTION_NAMES, HTTP_API_PATHS, TANSTACK_SERVER_FUNCTION_IDS };
