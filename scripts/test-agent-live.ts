/**
 * Live Gemini E2E for Lunayair AI Agent (uses GEMINI_API_KEY from .env).
 * Does NOT require Firebase Admin — reports retrieval source honestly.
 *
 * Run: npm run test:agent:live
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

import {
  emptyCustomerContext,
  extractContextFromMessage,
  updateConversationSummary,
  type CustomerContext,
} from "../src/lib/agent/context";
import { getChatbotConfig } from "../src/server/chatbot/config";
import { generateChatReply } from "../src/server/chatbot/openai";
import {
  buildHistoryContextSnippet,
  resetKnowledgeCacheForTests,
  retrieveKnowledge,
} from "../src/server/agent/retrieve";
import { hasFirebaseAdminCredentials } from "../src/server/agent/firebaseAdmin";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
loadEnv({ path: resolve(root, ".env") });

type CaseResult = {
  name: string;
  ok: boolean;
  intent: string;
  fromFallback: boolean;
  knowledgeSource: string;
  docCount: number;
  replyPreview: string;
  notes: string[];
};

const SINGLE_CASES: Array<{
  name: string;
  message: string;
  checks: (reply: string, intent: string) => string[];
}> = [
  {
    name: "Instagram",
    message: "في عندكم انستجرام؟",
    checks: (reply, intent) => {
      const notes: string[] = [];
      if (intent !== "social_media") notes.push(`intent=${intent} (expected social_media)`);
      if (!/instagram|انست/i.test(reply)) notes.push("reply missing Instagram mention");
      return notes;
    },
  },
  {
    name: "Services list",
    message: "إيه الخدمات اللي بتقدموها؟",
    checks: (reply, intent) => {
      const notes: string[] = [];
      if (!["services", "general_question"].includes(intent)) notes.push(`intent=${intent}`);
      if (reply.trim().length < 40) notes.push("reply too short");
      return notes;
    },
  },
  {
    name: "Yacht Management 360",
    message: "اشرحلي إدارة اليخوت 360",
    checks: (reply) => {
      const notes: string[] = [];
      if (!/360|إدارة|management|طاقم|صيان|تشغيل/i.test(reply)) {
        notes.push("reply missing yacht-management themes");
      }
      return notes;
    },
  },
  {
    name: "Recommendation 80ft Jeddah",
    message: "عندي يخت 80 قدم في جدة ومحتاج إدارة وصيانة",
    checks: (reply, intent) => {
      const notes: string[] = [];
      if (!["yacht_recommendation", "services", "service_details"].includes(intent)) {
        notes.push(`intent=${intent}`);
      }
      if (reply.trim().length < 40) notes.push("reply too short");
      return notes;
    },
  },
  {
    name: "Service comparison",
    message: "إيه الفرق بين إدارة اليخت وإدارة الطاقم؟",
    checks: (reply, intent) => {
      const notes: string[] = [];
      if (intent !== "service_comparison")
        notes.push(`intent=${intent} (expected service_comparison)`);
      if (reply.trim().length < 40) notes.push("reply too short");
      return notes;
    },
  },
  {
    name: "Contact",
    message: "إزاي أتواصل معاكم؟",
    checks: (reply, intent) => {
      const notes: string[] = [];
      if (intent !== "contact") notes.push(`intent=${intent} (expected contact)`);
      if (!/\+966|whatsapp|واتس|info@|email|هاتف|phone|تواصل/i.test(reply)) {
        notes.push("reply missing contact channel");
      }
      return notes;
    },
  },
  {
    name: "Unpublished pricing",
    message: "كم سعر إدارة يخت 80 قدم؟",
    checks: (reply) => {
      const notes: string[] = [];
      if (/\b\d{3,}\s*(sar|ريال|\$)/i.test(reply)) notes.push("reply invented a numeric price");
      if (!/غير|not published|custom|تواصل|contact|proposal|عرض/i.test(reply)) {
        notes.push("reply should admit pricing is unpublished / offer contact");
      }
      return notes;
    },
  },
  {
    name: "Unpublished availability",
    message: "هل عندكم مرسى متاح بكرة؟",
    checks: (reply) => {
      const notes: string[] = [];
      if (/نعم.*(متاح|available)|available tomorrow/i.test(reply)) {
        notes.push("reply invented availability");
      }
      return notes;
    },
  },
  {
    name: "Out of scope",
    message: "ما هو أفضل هاتف آيفون حالياً؟",
    checks: (reply) => {
      const notes: string[] = [];
      if (/iphone 1[567]|أيفون/i.test(reply) && !/لا|خارج|مختص|lunayair|مارينا/i.test(reply)) {
        notes.push("reply may be inventing out-of-scope product advice");
      }
      return notes;
    },
  },
];

async function runCase(
  name: string,
  message: string,
  language: "ar" | "en",
  history: Array<{ role: "user" | "assistant"; content: string }>,
  context: CustomerContext,
  summary: string,
  checks: (reply: string, intent: string) => string[],
): Promise<{ result: CaseResult; reply: string; context: CustomerContext; summary: string }> {
  const historyText = buildHistoryContextSnippet(history);
  const retrieval = await retrieveKnowledge(message, language, { context, historyText });
  const config = getChatbotConfig();
  const reply = await generateChatReply(config, language, message, history, retrieval.formatted, {
    conversationSummary: summary,
    customerContext: context,
  });
  const notes = checks(reply, retrieval.analysis.intent);
  return {
    result: {
      name,
      ok: notes.length === 0,
      intent: retrieval.analysis.intent,
      fromFallback: retrieval.fromFallback,
      knowledgeSource: retrieval.diagnostic.knowledgeSource,
      docCount: retrieval.documents.length,
      replyPreview: reply.replace(/\s+/g, " ").slice(0, 180),
      notes,
    },
    reply,
    context,
    summary,
  };
}

async function main() {
  resetKnowledgeCacheForTests();
  const config = getChatbotConfig();
  if (!config.openaiApiKey) {
    console.error("BLOCKED: OPENAI_API_KEY is not set in .env");
    process.exit(1);
  }

  console.log("\n=== LIVE GEMINI E2E ===\n");
  console.log(`Model: ${config.openaiModel}`);
  console.log(
    `Firebase Admin credentials: ${hasFirebaseAdminCredentials() ? "configured" : "NOT configured"}`,
  );

  const results: CaseResult[] = [];

  for (const testCase of SINGLE_CASES) {
    try {
      const { result } = await runCase(
        testCase.name,
        testCase.message,
        "ar",
        [],
        emptyCustomerContext(),
        "",
        testCase.checks,
      );
      results.push(result);
      console.log(
        `${result.ok ? "PASS" : "FAIL"} | ${result.name} | intent=${result.intent} | docs=${result.docCount} | fallback=${result.fromFallback} | source=${result.knowledgeSource}`,
      );
      console.log(`  reply: ${result.replyPreview}...`);
      if (result.notes.length) console.log(`  notes: ${result.notes.join("; ")}`);
    } catch (error) {
      results.push({
        name: testCase.name,
        ok: false,
        intent: "?",
        fromFallback: true,
        knowledgeSource: "error",
        docCount: 0,
        replyPreview: "",
        notes: [error instanceof Error ? error.message : String(error)],
      });
      console.log(`FAIL | ${testCase.name} | ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log("\n=== MULTI-TURN FOLLOW-UP ===\n");
  let context = emptyCustomerContext();
  let summary = "";
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  const turns = ["عندي يخت 80 قدم", "في جدة", "ومحتاج إدارة الطاقم والصيانة", "إيه أنسب خدمة؟"];

  try {
    for (const turn of turns) {
      context = extractContextFromMessage(turn, "ar", context).context;
      summary = updateConversationSummary(summary, turn, "ar", context);
      const { result, reply } = await runCase(
        `follow-up: ${turn}`,
        turn,
        "ar",
        history,
        context,
        summary,
        (r) => (r.trim().length < 10 ? ["empty reply"] : []),
      );
      history.push({ role: "user", content: turn });
      history.push({ role: "assistant", content: reply });
      results.push(result);
      console.log(
        `${result.ok ? "PASS" : "FAIL"} | ${turn} | intent=${result.intent} | context=${formatCtx(context)}`,
      );
      console.log(`  reply: ${result.replyPreview}...`);
    }

    const last = results[results.length - 1];
    const contextOk =
      Boolean(context.yachtLength?.includes("80")) &&
      context.location === "جدة" &&
      context.interests.includes("crew_management") &&
      context.interests.includes("maintenance_operations");
    if (!contextOk) {
      last.ok = false;
      last.notes.push(
        "multi-turn context incomplete (expected 80ft + Jeddah + crew + maintenance)",
      );
      console.log(`FAIL | context check | ${formatCtx(context)}`);
    } else {
      console.log(`PASS | context accumulated | ${formatCtx(context)}`);
    }
  } catch (error) {
    console.log(`FAIL | multi-turn | ${error instanceof Error ? error.message : error}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const anyFirestore = results.some((r) => !r.fromFallback);

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  console.log(
    `fromFallback observed: ${anyFirestore ? "false (Firestore used at least once)" : "true (static fallback only)"}`,
  );
  console.log(
    `NOTE: Firestore persistence of conversations/leads/candidates requires Admin credentials + published rules.`,
  );

  if (failed > 0) process.exit(1);
}

function formatCtx(context: CustomerContext): string {
  return [context.yachtLength, context.location, context.interests.join("+")]
    .filter(Boolean)
    .join(" | ");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
