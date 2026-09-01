/**
 * Minimal seroval codec for TanStack server-fn HTTP responses.
 * Request encoding uses the full seroval library; responses are decoded with a
 * small reader so Node test scripts do not need the browser seroval runtime.
 */
import { toJSON } from "seroval";

type SerovalNode = { t: number; s?: unknown; p?: { k: string[]; v: SerovalNode[] }; o?: number };

const SEROVAL_CONSTANTS: Record<number, unknown> = { 0: null, 1: undefined, 2: true, 3: false };

export function encodeServerFnPayload<T>(data: T): string {
  return JSON.stringify(toJSON({ data }));
}

export function decodeSerovalNode(node: SerovalNode | undefined): unknown {
  if (!node || typeof node !== "object") return undefined;
  if (node.t === 0 || node.t === 1) return node.s;
  if (node.t === 2) return SEROVAL_CONSTANTS[node.s as number];
  if (!node.p) return undefined;
  const decoded: Record<string, unknown> = {};
  node.p.k.forEach((key, index) => {
    decoded[key] = decodeSerovalNode(node.p?.v[index]);
  });
  return decoded;
}

/** Unwrap `{ result, error, context }` from a TanStack server-fn HTTP response body. */
export function decodeServerFnResponse(raw: unknown): unknown {
  const node = raw as SerovalNode & { t: SerovalNode | number };
  const root = typeof node.t === "object" ? node.t : (node as SerovalNode);
  const envelope = decodeSerovalNode(root) as {
    result?: unknown;
    error?: unknown;
  } | null;
  if (envelope?.error) {
    const err = envelope.error;
    if (err instanceof Error) throw err;
    if (typeof err === "object" && err !== null && "message" in err) {
      throw new Error(String((err as { message?: unknown }).message));
    }
    throw new Error("server_fn_error");
  }
  return envelope?.result;
}
