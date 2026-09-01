import type { ApiOperation } from "./endpoints";
import { FIREBASE_FUNCTION_NAMES } from "./endpoints";
import { getApiTransport } from "./config";

/** Firebase project ID (Gen2 function URL host segment). */
export const FIREBASE_PROJECT_ID = "lunayairmarina-2d694";

/** Default Cloud Functions region for Gen2 HTTPS endpoints. */
export const FIREBASE_FUNCTIONS_REGION =
  (import.meta.env.VITE_FUNCTIONS_REGION as string | undefined)?.trim() || "us-central1";

/**
 * Base URL for Firebase Cloud Functions Gen2 HTTPS endpoints.
 * Emulator / optional Blaze deploy only — not used by the cPanel static build.
 */
export function getFunctionsBaseUrl(): string {
  const fromEnv = (import.meta.env.VITE_FUNCTIONS_BASE_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return `https://${FIREBASE_FUNCTIONS_REGION}-${FIREBASE_PROJECT_ID}.cloudfunctions.net`;
}

/** Resolve the HTTP URL for a logical API operation (Firebase CF transport only). */
export function getHttpApiUrl(operation: ApiOperation): string {
  const functionsBase = (import.meta.env.VITE_FUNCTIONS_BASE_URL as string | undefined)?.trim();
  if (functionsBase || getApiTransport() === "http") {
    const fnName = FIREBASE_FUNCTION_NAMES[operation];
    return `${getFunctionsBaseUrl()}/${fnName}`;
  }
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "";
  return `${apiBase.replace(/\/$/, "")}/api/v1/${operation}`;
}
