import { TANSTACK_SERVER_FUNCTION_IDS } from "../src/lib/api/endpoints";
import { decodeServerFnResponse, encodeServerFnPayload } from "../src/lib/api/serovalCodec";

const VERCEL = "https://lunayairmarina.vercel.app";
const WWW = "https://www.lunayairmarina.com";
const id = TANSTACK_SERVER_FUNCTION_IDS.chatbotSendMessage;

async function sendChat(base: string, origin: string) {
  const url = `${base}/_serverFn/${id}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      origin,
      "x-tsr-serverFn": "true",
    },
    body: encodeServerFnPayload({
      message: "إيه الخدمات اللي بتقدموها؟",
      sessionId: `probe-${Date.now()}`,
      language: "ar",
    }),
  });
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) {
    return { base, ok: false, detail: "HTML — proxy/SPA fallback" };
  }
  const raw = await res.json();
  const result = decodeServerFnResponse(raw) as { ok?: boolean; code?: string; reply?: string; error?: string };
  if (result?.ok && result.reply) {
    return { base, ok: true, detail: result.reply.slice(0, 120) + "..." };
  }
  return { base, ok: false, detail: result?.code ?? result?.error ?? JSON.stringify(result).slice(0, 150) };
}

for (const [label, base] of [
  ["Vercel", VERCEL],
  ["www", WWW],
] as const) {
  const r = await sendChat(base, WWW);
  console.log(`${r.ok ? "✅" : "❌"} ${label}: ${r.detail}`);
}
