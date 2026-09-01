import type { ApiOperation } from "./endpoints";

/** Stub — static cPanel builds never use Firebase Cloud Functions transport. */
export function getHttpApiUrl(_operation: ApiOperation): string {
  throw new Error("http_transport_unavailable_in_static_build");
}
