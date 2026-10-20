import { TANSTACK_SERVER_FUNCTION_IDS } from "../src/lib/api/endpoints";
import { decodeServerFnResponse, encodeServerFnPayload } from "../src/lib/api/serovalCodec";

const id = TANSTACK_SERVER_FUNCTION_IDS.chatbotSendMessage;
const body = encodeServerFnPayload({
  message: "اهلا",
  sessionId: `check-${Date.now()}`,
  language: "ar",
});

async function probe(label: string, base: string, origin: string) {
  try {
    const res = await fetch(`${base}/_serverFn/${id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "x-tsr-serverFn": "true",
      },
      body,
    });
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/html")) {
      console.log(`${label}: FAIL HTML ${res.status}`);
      return;
    }
    const result = decodeServerFnResponse(await res.json()) as {
      ok?: boolean;
      code?: string;
      reply?: string;
    };
    if (result?.ok && result.reply) {
      console.log(`${label}: OK → ${result.reply.slice(0, 70)}...`);
    } else {
      console.log(`${label}: FAIL code=${result?.code ?? "?"} ${JSON.stringify(result).slice(0, 120)}`);
    }
  } catch (error) {
    console.log(`${label}: ERR ${error instanceof Error ? error.message : error}`);
  }
}

await probe("Vercel (من www)", "https://lunayairmarina.vercel.app", "https://www.lunayairmarina.com");
await probe("Vercel (من localhost)", "https://lunayairmarina.vercel.app", "http://localhost:3000");
await probe("Local /_serverFn", "http://localhost:3000", "http://localhost:3000");
