/**
 * Authorization matrix for Firebase Cloud Functions (emulator).
 * Requires: functions + auth + firestore emulators, seed-auth-emulator.mjs
 */
import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import seedAuth, { AUTH_TEST_USERS } from "./seed-auth-emulator.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(root, ".env") });
loadEnv({ path: resolve(root, "functions/.secret.local") });

const base =
  process.env.FUNCTIONS_BASE?.replace(/\/$/, "") ??
  "http://127.0.0.1:5001/lunayairmarina-2d694/us-central1";

async function post(path, body = {}, headers = {}) {
  const response = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

function isAllowed(status) {
  return status >= 200 && status < 300;
}

function isUnauthorized(status) {
  return status === 401;
}

function isForbidden(status) {
  return status === 403;
}

const matrix = [
  {
    fn: "aiTriggerKnowledgeSync",
    body: {},
    cases: {
      A: { expect: isUnauthorized },
      B: { headers: { Authorization: "Bearer invalid.e2e.token" }, expect: isUnauthorized },
      C: { tokenKey: "normal", expect: isForbidden },
      D: { tokenKey: "activeAdmin", expect: isAllowed },
      E: { tokenKey: "superAdmin", expect: isAllowed },
    },
  },
  {
    fn: "aiDeleteConversation",
    body: { sessionId: "auth-matrix-session" },
    cases: {
      A: { expect: isUnauthorized },
      B: { headers: { Authorization: "Bearer invalid.e2e.token" }, expect: isUnauthorized },
      C: { tokenKey: "normal", expect: isForbidden },
      D: { tokenKey: "activeAdmin", expect: isAllowed },
      E: { tokenKey: "superAdmin", expect: isAllowed },
    },
  },
  {
    fn: "aiDeleteAllConversations",
    body: {},
    cases: {
      A: { expect: isUnauthorized },
      B: { headers: { Authorization: "Bearer invalid.e2e.token" }, expect: isUnauthorized },
      C: { tokenKey: "normal", expect: isForbidden },
      D: { tokenKey: "activeAdmin", expect: isForbidden },
      E: { tokenKey: "superAdmin", expect: isAllowed },
    },
  },
  {
    fn: "adminSetUserPassword",
    body: { uid: AUTH_TEST_USERS.normal.uid, password: "password123" },
    cases: {
      A: { expect: isUnauthorized },
      B: { headers: { Authorization: "Bearer invalid.e2e.token" }, expect: isUnauthorized },
      C: { tokenKey: "normal", expect: isForbidden },
      D: { tokenKey: "activeAdmin", expect: isForbidden },
      E: { tokenKey: "superAdmin", expect: isAllowed },
    },
  },
];

const usingFirestoreEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST?.trim());

async function main() {
  console.log(`Auth matrix base: ${base}`);
  console.log(
    `Firestore emulator: ${usingFirestoreEmulator ? "yes" : "no (destructive super-admin ops skipped)"}`,
  );
  const tokens = await seedAuth();
  const results = [];

  for (const entry of matrix) {
    for (const [label, spec] of Object.entries(entry.cases)) {
      if (
        !usingFirestoreEmulator &&
        entry.fn === "aiDeleteAllConversations" &&
        label === "E"
      ) {
        console.log(`SKIP ${entry.fn} [${label}] — requires Firestore emulator (Java)`);
        results.push({ name: `${entry.fn} [${label}]`, pass: true, skipped: true });
        continue;
      }

      const headers = { ...(spec.headers ?? {}) };
      if (spec.tokenKey) {
        headers.Authorization = `Bearer ${tokens[spec.tokenKey]}`;
      }
      const res = await post(entry.fn, entry.body, headers);
      const pass = spec.expect(res.status);
      const name = `${entry.fn} [${label}]`;
      console.log(`${pass ? "PASS" : "FAIL"} ${name} — status=${res.status}`);
      results.push({ name, pass, status: res.status });
    }
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\nAuthorization matrix: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    for (const item of failed) {
      console.log(` - ${item.name}: status=${item.status}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
