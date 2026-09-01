/**
 * Local E2E credential verification for Firebase Functions emulator.
 * Never logs secrets or full auth tokens.
 */
import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(root, ".env") });
loadEnv({ path: resolve(root, "functions/.secret.local") });

const base =
  process.env.FUNCTIONS_BASE?.replace(/\/$/, "") ??
  "http://127.0.0.1:5001/lunayairmarina-2d694/us-central1";

async function post(path, body, headers = {}) {
  const response = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

function record(name, pass, detail) {
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${detail}`);
  return pass;
}

const results = [];

async function main() {
  console.log(`E2E base: ${base}`);
  console.log(`GEMINI configured: ${process.env.GEMINI_API_KEY?.trim() ? "yes" : "no"}`);
  console.log(
    `Admin configured: ${
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
        ? "yes"
        : "no"
    }`,
  );

  const chat = await post("chatbotSendMessage", {
    sessionId: `e2e-${Date.now()}`,
    language: "en",
    message: "What yacht management services do you offer?",
    visitorName: "E2ETest",
    isReturning: false,
  });
  const chatBody = chat.json && typeof chat.json === "object" ? chat.json : {};
  const chatOk =
    chat.status === 200 &&
    chatBody.ok === true &&
    typeof chatBody.reply === "string" &&
    chatBody.reply.trim().length > 20;
  results.push(
    record(
      "chatbotSendMessage (Gemini live)",
      chatOk,
      `status=${chat.status} ok=${String(chatBody.ok)} replyLen=${String(chatBody.reply?.length ?? 0)}`,
    ),
  );

  const sessionId = `e2e-contact-${Date.now()}`;
  const contact = await post("chatbotSubmitContact", {
    sessionId,
    language: "en",
    name: "E2E Test",
    phone: "+966531561212",
    email: "e2e-test@example.com",
  });
  const contactBody = contact.json && typeof contact.json === "object" ? contact.json : {};
  const contactOk =
    contact.status === 200 && contactBody.ok === true && typeof contactBody.confirmation === "string";
  results.push(
    record(
      "chatbotSubmitContact (Firestore Admin live)",
      contactOk,
      `status=${contact.status} ok=${String(contactBody.ok)} code=${String(contactBody.code ?? "n/a")}`,
    ),
  );

  for (const [path, body] of [
    ["aiTriggerKnowledgeSync", {}],
    ["aiDeleteConversation", { sessionId: "e2e-invalid-auth" }],
    ["aiDeleteAllConversations", {}],
    ["adminSetUserPassword", { uid: "fake", password: "password123" }],
  ]) {
    const res = await post(path, body);
    results.push(record(`${path} (no auth)`, res.status === 401, `status=${res.status}`));
  }

  const invalid = await post(
    "aiTriggerKnowledgeSync",
    {},
    { Authorization: "Bearer invalid.e2e.token" },
  );
  results.push(
    record(
      "aiTriggerKnowledgeSync (invalid token)",
      invalid.status === 401,
      `status=${invalid.status}`,
    ),
  );

  const invalidSuper = await post(
    "adminSetUserPassword",
    { uid: "fake", password: "password123" },
    { Authorization: "Bearer invalid.e2e.token" },
  );
  results.push(
    record(
      "adminSetUserPassword (invalid token)",
      invalidSuper.status === 401,
      `status=${invalidSuper.status}`,
    ),
  );

  console.log(`\nSummary: ${results.filter(Boolean).length}/${results.length} passed`);
  if (results.some((r) => !r)) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
