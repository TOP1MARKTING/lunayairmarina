/**
 * Smoke-test Firebase Cloud Functions (emulator or deployed base URL).
 *
 * Usage:
 *   FUNCTIONS_BASE=http://127.0.0.1:5001/lunayairmarina-2d694/us-central1 npm run test:functions
 *   npm run test:functions -- --emulator
 */
import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FIREBASE_FUNCTION_NAMES, type ApiOperation } from "../src/lib/api/endpoints";

loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../functions/.secret.local") });

const useEmulator =
  process.argv.includes("--emulator") || process.env.FUNCTIONS_EMULATOR === "1";
const PROJECT = "lunayairmarina-2d694";
const REGION = process.env.VITE_FUNCTIONS_REGION?.trim() || "us-central1";
const DEFAULT_BASE = useEmulator
  ? `http://127.0.0.1:5001/${PROJECT}/${REGION}`
  : `https://${REGION}-${PROJECT}.cloudfunctions.net`;

const base = (process.env.FUNCTIONS_BASE ?? process.env.VITE_FUNCTIONS_BASE_URL ?? DEFAULT_BASE).replace(
  /\/$/,
  "",
);

function fnUrl(name: string): string {
  return `${base}/${name}`;
}

async function postJson<T>(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: T | null; text: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: T | null = null;
  try {
    json = JSON.parse(text) as T;
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

type Check = { name: string; pass: boolean; detail: string };

const checks: Check[] = [];

function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${detail}`);
}

async function testPublicChatbot() {
  const url = fnUrl(FIREBASE_FUNCTION_NAMES.chatbotSendMessage);
  const payload = {
    sessionId: `fn-test-${Date.now()}`,
    language: "en",
    message: "Hello, what services do you offer?",
    visitorName: "FnTest",
    isReturning: false,
  };
  const { status, json } = await postJson<{ ok?: boolean; reply?: string }>(url, payload);
  const pass = status === 200 && json !== null && typeof json === "object";
  record("chatbotSendMessage", pass, `status=${status} ok=${String((json as { ok?: boolean })?.ok)}`);
}

async function testPublicContact() {
  const sessionId = `fn-contact-${Date.now()}`;
  const url = fnUrl(FIREBASE_FUNCTION_NAMES.chatbotSubmitContact);
  const payload = {
    sessionId,
    language: "en",
    name: "Fn Test",
    phone: "+966531561212",
    email: "test@example.com",
  };
  const { status, json } = await postJson<{ ok?: boolean }>(url, payload);
  record("chatbotSubmitContact", status === 200, `status=${status} body=${JSON.stringify(json)}`);
}

async function testAdminUnauthorized(operation: ApiOperation, body: Record<string, unknown> = {}) {
  const url = fnUrl(FIREBASE_FUNCTION_NAMES[operation]);
  const { status } = await postJson(url, body);
  record(`${operation} (no auth)`, status === 401 || status === 403, `status=${status}`);
}

async function main() {
  console.log(`Functions base: ${base}`);
  console.log(`Mode: ${useEmulator ? "emulator" : "remote"}`);

  await testPublicChatbot();
  await testPublicContact();
  await testAdminUnauthorized("aiTriggerKnowledgeSync");
  await testAdminUnauthorized("aiDeleteConversation", { sessionId: "missing-auth-test" });
  await testAdminUnauthorized("aiDeleteAllConversations");
  await testAdminUnauthorized("adminSetUserPassword", {
    uid: "fake",
    password: "password123",
    idToken: "",
  });

  const failed = checks.filter((item) => !item.pass);
  console.log(`\nSummary: ${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) {
    console.log("Failures:");
    for (const item of failed) console.log(` - ${item.name}: ${item.detail}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
