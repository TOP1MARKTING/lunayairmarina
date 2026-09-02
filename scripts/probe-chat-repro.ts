/**
 * Reproduce long-conversation failures locally and on Production.
 * No secrets logged.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { processChatMessage } from "../src/server/chatbot/chat";
import { resetRateLimitStoreForTests } from "../src/server/chatbot/rateLimit";
import { getChatbotConfig } from "../src/server/chatbot/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

const BASE = process.env.PROD_BASE_URL ?? "https://www.lunayairmarina.com";
const CHAT_FN = "8c3a24bfc2c03a6dbfec2ea9285c2a0884d1f92e8df4a37e1e4d4d4fd0e5b57a";

type HistoryItem = { role: "user" | "assistant"; content: string };

const USER_MESSAGES = [
  "أهلا بيك",
  "والدي عايز يأجر يخت",
  "تعرف عن إدارة المواقع",
  "ممكن تبعتلي رقم تواصل أو عنوان المكتب",
  "ممكن أعرف برضو أهمية اليخوت",
  "هو التأجير كويس ولا الشراء",
  "تاجير",
];

function tsrString(s: string) {
  return { t: 1, s };
}

function tsrHistory(history: HistoryItem[]) {
  const items = history.map((item) => ({
    t: 10,
    i: 1,
    p: {
      k: ["role", "content"],
      v: [tsrString(item.role), tsrString(item.content)],
    },
    o: 0,
  }));
  return { t: 9, i: 1, a: items, o: 0 };
}

function buildPayload(data: Record<string, unknown>) {
  const keys = Object.keys(data);
  const vals = keys.map((k) => {
    const v = data[k];
    if (Array.isArray(v)) return tsrHistory(v as HistoryItem[]);
    return tsrString(String(v));
  });
  return JSON.stringify({
    t: {
      t: 10,
      i: 0,
      p: { k: ["data"], v: [{ t: 10, i: 1, p: { k: keys, v: vals }, o: 0 }] },
      o: 0,
    },
    f: 127,
    m: [],
  });
}

async function callProduction(
  sessionId: string,
  message: string,
  history: HistoryItem[],
): Promise<{ ms: number; status: number; text: string }> {
  const headers = {
    "content-type": "application/json",
    accept: "application/x-tss-framed, application/x-ndjson, application/json",
    "x-tsr-serverfn": "true",
    referer: `${BASE}/`,
  };
  const t0 = Date.now();
  const res = await fetch(`${BASE}/_serverFn/${CHAT_FN}`, {
    method: "POST",
    headers,
    body: buildPayload({ sessionId, language: "ar", message, history }),
  });
  return { ms: Date.now() - t0, status: res.status, text: await res.text() };
}

function parseCode(text: string): string {
  if (text.includes('"code"') && text.includes('"VALIDATION"')) return "VALIDATION";
  if (text.includes('"code"') && text.includes('"RATE_LIMIT"')) return "RATE_LIMIT";
  if (text.includes('"code"') && text.includes('"SERVICE"')) return "SERVICE";
  if (text.includes('"reply"') || text.includes('s":2')) return "OK";
  return "UNKNOWN";
}

async function runLocal(sessionId: string) {
  console.log("\n=== LOCAL processChatMessage ===\n");
  const config = getChatbotConfig();
  console.log(`geminiKeyPresent=${Boolean(config.openaiApiKey)}`);

  let history: HistoryItem[] = [
    {
      role: "user",
      content: "بيانات التواصل:\nالاسم: Test\nالجوال: +966500000001",
    },
    { role: "assistant", content: "شكراً، تم استلام بياناتك." },
  ];

  for (let i = 0; i < USER_MESSAGES.length; i += 1) {
    resetRateLimitStoreForTests();
    const message = USER_MESSAGES[i]!;
    const result = await processChatMessage({
      sessionId,
      language: "ar",
      message,
      history,
    });
    console.log(
      `turn=${i + 1} history=${history.length} ok=${result.ok} code=${result.ok ? "OK" : result.code} msg=${message.slice(0, 40)}`,
    );
    if (!result.ok) return { failedAt: i + 1, code: result.code };
    history = [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: result.reply.slice(0, 500) },
    ];
  }
  return { failedAt: 0, code: "OK" };
}

async function runProduction(sessionId: string, useEmptyClientHistory = false) {
  console.log("\n=== PRODUCTION HTTP ===\n");
  console.log(`base=${BASE} emptyClientHistory=${useEmptyClientHistory}`);

  let history: HistoryItem[] = [
    {
      role: "user",
      content: "بيانات التواصل:\nالاسم: Test\nالجوال: +966500000001",
    },
    { role: "assistant", content: "شكراً، تم استلام بياناتك." },
  ];

  for (let i = 0; i < USER_MESSAGES.length; i += 1) {
    const message = USER_MESSAGES[i]!;
    const clientHistory = useEmptyClientHistory ? [] : history;
    const res = await callProduction(sessionId, message, clientHistory);
    const code = parseCode(res.text);
    console.log(
      `turn=${i + 1} clientHistory=${clientHistory.length} status=${res.status} ms=${res.ms} code=${code} msg=${message.slice(0, 40)}`,
    );
    if (code !== "OK") {
      console.log(`responseSnippet=${res.text.slice(0, 300)}`);
      return { failedAt: i + 1, code };
    }
    history = [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: "ok" },
    ];
  }
  return { failedAt: 0, code: "OK" };
}

async function probeHistoryThreshold() {
  console.log("\n=== PRODUCTION history threshold ===\n");
  for (const n of [7, 8, 9, 10, 11, 12, 20]) {
    const history = Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
    })) as HistoryItem[];
    const res = await callProduction(`thresh${n}12345678`, "test", history);
    const code = parseCode(res.text);
    console.log(`historyLen=${n} ms=${res.ms} code=${code}`);
  }
}

const sessionId = `repro${Date.now().toString(36).slice(-12)}`;
const mode = process.argv[2] ?? "both";

const out: Record<string, unknown> = { sessionId };

if (mode === "local" || mode === "both") {
  out.local = await runLocal(sessionId);
}
if (mode === "production" || mode === "both") {
  out.productionLegacy = await runProduction(`${sessionId}prod`, false);
  out.productionEmptyHistory = await runProduction(`${sessionId}empty`, true);
}
if (mode === "threshold") {
  await probeHistoryThreshold();
}

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(out, null, 2));
