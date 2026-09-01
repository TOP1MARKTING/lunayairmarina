import type { ApiOperation } from "./endpoints";
import { FIREBASE_FUNCTION_NAMES, HTTP_API_PATHS } from "./endpoints";

export type ApiTransport = "http" | "server-fn";

/**
 * Defaults to `server-fn` so SSR deployments (Vercel) call TanStack server
 * functions. Only the static-hosting build opts into `http`, which requires
 * deployed Firebase Cloud Functions.
 */
export function getApiTransport(): ApiTransport {
  const raw = (import.meta.env.VITE_API_TRANSPORT as string | undefined)?.trim();
  return raw === "http" ? "http" : "server-fn";
}

export function isStaticHostingBuild(): boolean {
  return (import.meta.env.VITE_STATIC_HOSTING as string | undefined) === "true";
}

/** Firebase project ID (Gen2 function URL host segment). */
export const FIREBASE_PROJECT_ID = "lunayairmarina-2d694";

/** Default Cloud Functions region for Gen2 HTTPS endpoints. */
export const FIREBASE_FUNCTIONS_REGION =
  (import.meta.env.VITE_FUNCTIONS_REGION as string | undefined)?.trim() || "us-central1";

/** Remote API origin for static hosting (Vercel SSR fallback when unset). */
export function getApiBaseUrl(): string {
  const fromEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  const base = fromEnv || "https://www.lunayairmarina.com";
  return base.replace(/\/$/, "");
}

/**
 * Base URL for Firebase Cloud Functions Gen2 HTTPS endpoints.
 * Emulator: http://127.0.0.1:5001/lunayairmarina-2d694/us-central1
 * Production: https://us-central1-lunayairmarina-2d694.cloudfunctions.net
 */
export function getFunctionsBaseUrl(): string {
  const fromEnv = (import.meta.env.VITE_FUNCTIONS_BASE_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return `https://${FIREBASE_FUNCTIONS_REGION}-${FIREBASE_PROJECT_ID}.cloudfunctions.net`;
}

/** Resolve the HTTP URL for a logical API operation. */
export function getHttpApiUrl(operation: ApiOperation): string {
  const functionsBase = (import.meta.env.VITE_FUNCTIONS_BASE_URL as string | undefined)?.trim();
  if (functionsBase || isStaticHostingBuild() || getApiTransport() === "http") {
    const fnName = FIREBASE_FUNCTION_NAMES[operation];
    return `${getFunctionsBaseUrl()}/${fnName}`;
  }
  return `${getApiBaseUrl()}${HTTP_API_PATHS[operation]}`;
}

/**
 * TanStack Start server-function path prefix on the remote SSR host.
 * Override if your deployment uses a non-default base.
 */
export function getTanStackServerFnBase(): string {
  const fromEnv = (import.meta.env.VITE_TSS_SERVER_FN_BASE as string | undefined)?.trim();
  const base = fromEnv || "/_serverFn/";
  return base.endsWith("/") ? base : `${base}/`;
}
