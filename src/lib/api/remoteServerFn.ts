import { getApiBaseUrl, getTanStackServerFnUrl } from "./config";
import type { ApiOperation } from "./endpoints";
import { decodeServerFnResponse, encodeServerFnPayload } from "./serovalCodec";

export type RemoteServerFnArgs<TData> = {
  data: TData;
  headers?: HeadersInit;
};

/**
 * Call a TanStack server function on the remote Vercel backend from a static
 * cPanel-hosted browser bundle (cross-origin).
 */
export async function callRemoteServerFn<TData, TResult>(
  operation: ApiOperation,
  args: RemoteServerFnArgs<TData>,
): Promise<TResult> {
  const url = getTanStackServerFnUrl(operation);
  const pageOrigin =
    typeof window !== "undefined" ? window.location.origin : getApiBaseUrl();

  const headers = new Headers(args.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("accept", "application/json");
  headers.set("x-tsr-serverFn", "true");
  if (!headers.has("origin")) {
    headers.set("origin", pageOrigin);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: encodeServerFnPayload(args.data),
    credentials: "omit",
    mode: "cors",
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `HTTP ${response.status}`);
    }
    return text as TResult;
  }

  const raw = await response.json();
  if (!response.ok) {
    throw new Error(
      raw && typeof raw === "object" && "error" in raw
        ? String((raw as { error?: unknown }).error)
        : `HTTP ${response.status}`,
    );
  }

  try {
    return decodeServerFnResponse(raw) as TResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "server_fn_decode_failed";
    throw new Error(message);
  }
}
