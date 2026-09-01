/**
 * Authorization matrix for the TanStack server-fn transport (Vercel path).
 *
 * Drives real HTTP requests against the built SSR server so the check runs at
 * the actual server-function boundary, not against imported handlers.
 *
 * Requires: Auth + Firestore emulators, and `node .output/server/index.mjs`
 * started with FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST set so
 * no production data is touched.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { toJSON } from "seroval";
import { TANSTACK_SERVER_FUNCTION_IDS } from "../src/lib/api/endpoints";
import seedAuth from "./seed-auth-emulator.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(root, ".env") });

const ssrBase = (process.env.SSR_BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");

if (!process.env.FIRESTORE_EMULATOR_HOST?.trim()) {
  console.error(
    "Refusing to run: FIRESTORE_EMULATOR_HOST is not set. This suite performs destructive " +
      "admin operations and must never target production Firestore.",
  );
  process.exit(1);
}

/** Guard against stale hashes: every ID must exist in the built client bundle. */
function assertIdsMatchBuild(): void {
  const assetsDir = resolve(root, ".output/public/assets");
  let bundled = "";
  for (const file of readdirSync(assetsDir)) {
    if (file.endsWith(".js")) bundled += readFileSync(resolve(assetsDir, file), "utf8");
  }
  const stale = Object.entries(TANSTACK_SERVER_FUNCTION_IDS).filter(
    ([, id]) => !bundled.includes(id),
  );
  if (stale.length) {
    console.error(
      `Server function IDs not found in the current build: ${stale
        .map(([name]) => name)
        .join(", ")}. Rebuild, then refresh TANSTACK_SERVER_FUNCTION_IDS.`,
    );
    process.exit(1);
  }
}

type SerovalNode = { t: number; s?: unknown; p?: { k: string[]; v: SerovalNode[] } };

const SEROVAL_CONSTANTS: Record<number, unknown> = { 0: null, 1: undefined, 2: true, 3: false };

/**
 * Minimal seroval reader for the subset the responses use (objects, strings,
 * numbers, constants). Avoids seroval's browser-oriented runtime in Node.
 */
function decodeSeroval(node: SerovalNode | undefined): unknown {
  if (!node || typeof node !== "object") return undefined;
  if (node.t === 0 || node.t === 1) return node.s;
  if (node.t === 2) return SEROVAL_CONSTANTS[node.s as number];
  if (!node.p) return undefined;
  const decoded: Record<string, unknown> = {};
  node.p.k.forEach((key, index) => {
    decoded[key] = decodeSeroval(node.p?.v[index]);
  });
  return decoded;
}

async function callServerFn(functionId: string, payload: unknown) {
  const response = await fetch(`${ssrBase}/_serverFn/${functionId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tsr-serverFn": "true",
      origin: ssrBase,
      referer: `${ssrBase}/admin/ai`,
    },
    // The server treats the decoded body as the handler argument object.
    body: JSON.stringify(toJSON({ data: payload })),
  });
  // Responses are seroval-encoded and wrapped as { result, error, context }.
  let body: { ok?: boolean; error?: string } | null = null;
  try {
    const raw = (await response.json()) as SerovalNode & { t: SerovalNode | number };
    const root = typeof raw.t === "object" ? raw.t : (raw as SerovalNode);
    const envelope = decodeSeroval(root) as { result?: unknown } | null;
    body = (envelope?.result ?? null) as { ok?: boolean; error?: string } | null;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

/** Denied means the operation did not run: either a non-2xx or an ok:false result. */
function isDenied(result: Awaited<ReturnType<typeof callServerFn>>): boolean {
  if (result.status >= 400) return true;
  return result.body?.ok === false;
}

function isAllowed(result: Awaited<ReturnType<typeof callServerFn>>): boolean {
  return result.status < 400 && result.body?.ok === true;
}

type CaseKey = "A" | "C" | "D" | "E";

const CASE_LABELS: Record<CaseKey, string> = {
  A: "no token",
  C: "normal user",
  D: "active admin",
  E: "super admin",
};

const matrix: Array<{
  fn: keyof typeof TANSTACK_SERVER_FUNCTION_IDS;
  payload: Record<string, unknown>;
  expect: Record<CaseKey, "allow" | "deny">;
}> = [
  {
    fn: "aiTriggerKnowledgeSync",
    payload: {},
    expect: { A: "deny", C: "deny", D: "allow", E: "allow" },
  },
  {
    fn: "aiDeleteConversation",
    payload: { sessionId: "server-fn-auth-probe" },
    expect: { A: "deny", C: "deny", D: "allow", E: "allow" },
  },
  {
    fn: "aiDeleteAllConversations",
    payload: {},
    expect: { A: "deny", C: "deny", D: "deny", E: "allow" },
  },
];

async function main() {
  assertIdsMatchBuild();
  console.log(`Server-fn auth matrix base: ${ssrBase}`);
  console.log(`Firestore emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`);

  const tokens = await seedAuth();
  const tokenFor: Record<CaseKey, string> = {
    A: "",
    C: tokens.normal,
    D: tokens.activeAdmin,
    E: tokens.superAdmin,
  };

  let failed = 0;
  let total = 0;

  for (const entry of matrix) {
    const functionId = TANSTACK_SERVER_FUNCTION_IDS[entry.fn];
    for (const key of Object.keys(entry.expect) as CaseKey[]) {
      total += 1;
      const result = await callServerFn(functionId, {
        ...entry.payload,
        idToken: tokenFor[key],
      });
      const expected = entry.expect[key];
      const pass = expected === "allow" ? isAllowed(result) : isDenied(result);
      if (!pass) failed += 1;
      console.log(
        `${pass ? "PASS" : "FAIL"} ${entry.fn} [${key}] ${CASE_LABELS[key]} — expected=${expected} ` +
          `status=${result.status} ok=${result.body?.ok} error=${result.body?.error ?? "-"}`,
      );
    }
  }

  console.log(`\nServer-fn authorization matrix: ${total - failed}/${total} passed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
