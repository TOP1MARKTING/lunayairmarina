/**
 * Company Knowledge Agent probe — unexpected / paraphrased questions
 * not copied from the existing regression suite.
 *
 * Run: node --import tsx scripts/probe-company-agent.ts
 * Optional live Gemini: PROBE_COMPANY_GEMINI=1
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

import { analyzeQuery } from "../src/lib/agent/query";
import {
  emptyCustomerContext,
  extractContextFromMessage,
  updateConversationSummary,
} from "../src/lib/agent/context";
import {
  resetKnowledgeCacheForTests,
  retrieveKnowledge,
} from "../src/server/agent/retrieve";
import { generateChatReply } from "../src/server/chatbot/openai";
import { getChatbotConfig } from "../src/server/chatbot/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

type Case = {
  id: string;
  language: "ar" | "en";
  query: string;
  expectIntent?: string[];
  expectTypesAny?: string[];
  minDocs?: number;
  allowEmpty?: boolean;
  multiTurn?: string[];
};

const CASES: Case[] = [
  {
    id: "conceptual-full-ops-ar",
    language: "ar",
    query: "عايز حد يشيل عني تشغيل اليخت بالكامل",
    expectIntent: ["yacht_recommendation"],
    expectTypesAny: ["service", "faq", "why", "about"],
    minDocs: 1,
  },
  {
    id: "busy-owner-ar",
    language: "ar",
    query: "أنا مالك يخت ومشغول، هل أقدر أخليكم تديروا الموضوع كله؟",
    expectIntent: ["yacht_recommendation"],
    expectTypesAny: ["service", "faq", "why", "about"],
    minDocs: 1,
  },
  {
    id: "jeddah-crew-maint-ar",
    language: "ar",
    query: "عندي يخت في جدة ومحتاج حد يتابع الطاقم والصيانة والتشغيل كله",
    expectIntent: ["yacht_recommendation"],
    expectTypesAny: ["service", "location", "faq"],
    minDocs: 2,
  },
  {
    id: "big-yacht-no-daily-ops-ar",
    language: "ar",
    query: "أنا عندي يخت كبير ومش عايز أدخل في تفاصيل التشغيل اليومية، إيه اللي تقدروا تعملوه؟",
    expectIntent: ["yacht_recommendation"],
    expectTypesAny: ["service", "faq", "why"],
    minDocs: 1,
  },
  {
    id: "hands-off-en",
    language: "en",
    query: "I own a yacht but I want a hands-off setup — can you run operations end to end?",
    expectIntent: ["yacht_recommendation"],
    expectTypesAny: ["service", "faq", "why"],
    minDocs: 1,
  },
  {
    id: "compare-without-names-ar",
    language: "ar",
    query: "فيه فرق بين إنكم تديروا اليخت بالكامل وبين إنكم تتابعوا الطاقم بس؟",
    expectIntent: ["service_comparison", "yacht_recommendation"],
    expectTypesAny: ["service"],
    minDocs: 1,
  },
  {
    id: "paraphrase-instagram-ar",
    language: "ar",
    query: "حسابكم على انستا موجود؟",
    expectIntent: ["social_media"],
    expectTypesAny: ["company", "contact"],
    minDocs: 1,
  },
  {
    id: "missing-price-ar",
    language: "ar",
    query: "بكام باقة الإدارة الكاملة سنوياً بالضبط؟",
    expectIntent: ["pricing", "yacht_recommendation"],
    allowEmpty: false,
  },
  {
    id: "out-of-scope-en",
    language: "en",
    query: "Can you fix my iPhone screen tomorrow in Riyadh?",
    allowEmpty: true,
  },
  {
    id: "multi-turn-recommend",
    language: "ar",
    query: "إيه أنسب حل؟",
    expectIntent: ["yacht_recommendation"],
    expectTypesAny: ["service"],
    minDocs: 1,
    multiTurn: ["عندي يخت 75 قدم", "في جدة", "ومحتاج صيانة وطاقم"],
  },
];

function looksGroundedRefuse(text: string): boolean {
  return /غير منشور|not published|custom proposal|تواصل|contact|لا أملك|do not have|غير متاح|not available/i.test(
    text,
  );
}

async function main() {
  resetKnowledgeCacheForTests();
  const withGemini = process.env.PROBE_COMPANY_GEMINI === "1";
  const config = withGemini ? getChatbotConfig() : null;
  console.log(`\n=== COMPANY KNOWLEDGE AGENT PROBE (gemini=${withGemini ? "on" : "off"}) ===\n`);

  let pass = 0;
  let fail = 0;

  for (const testCase of CASES) {
    let context = emptyCustomerContext();
    let summary = "";
    let historyText = "";
    if (testCase.multiTurn?.length) {
      for (const turn of testCase.multiTurn) {
        const extracted = extractContextFromMessage(turn, testCase.language, context);
        context = extracted.context;
        summary = updateConversationSummary(summary, turn, testCase.language, context);
        historyText = `${historyText} ${turn}`.trim();
      }
    }

    const analysis = analyzeQuery(testCase.query);
    const result = await retrieveKnowledge(testCase.query, testCase.language, {
      context,
      historyText: historyText || undefined,
    });
    const types = [...new Set(result.diagnostic.selected.map((item) => item.type))];
    const issues: string[] = [];

    if (testCase.expectIntent?.length && !testCase.expectIntent.includes(analysis.intent)) {
      // After retrieve soft-upgrade, diagnostic intent may differ — check both.
      if (!testCase.expectIntent.includes(result.analysis.intent)) {
        issues.push(
          `intent got ${analysis.intent}/${result.analysis.intent}, expected ${testCase.expectIntent.join("|")}`,
        );
      }
    }

    if (testCase.expectTypesAny?.length) {
      const ok = testCase.expectTypesAny.some((type) => types.includes(type as never));
      if (!ok) issues.push(`expected one of [${testCase.expectTypesAny}], got [${types}]`);
    }

    if (typeof testCase.minDocs === "number" && result.documents.length < testCase.minDocs) {
      issues.push(`expected >=${testCase.minDocs} docs, got ${result.documents.length}`);
    }

    if (result.fromFallback) issues.push("fromFallback=true");
    if (result.diagnostic.knowledgeSource !== "firestore-admin") {
      issues.push(`knowledgeSource=${result.diagnostic.knowledgeSource}`);
    }

    let replyPreview = "";
    if (withGemini && config) {
      try {
        const reply = await generateChatReply(
          config,
          testCase.language,
          testCase.query,
          [],
          result.formatted,
          { conversationSummary: summary, customerContext: context },
        );
        replyPreview = reply.replace(/\s+/g, " ").slice(0, 220);
        if (testCase.id.startsWith("missing-price") || testCase.id.startsWith("out-of-scope")) {
          if (!looksGroundedRefuse(reply)) {
            issues.push(`expected grounded refuse/contact, got: ${replyPreview}`);
          }
        }
        if (
          testCase.id.includes("ops") ||
          testCase.id.includes("busy") ||
          testCase.id.includes("hands")
        ) {
          if (!/360|إدارة اليخوت|yacht management|تشغيل|operations|طاقم|crew/i.test(reply)) {
            issues.push(`reply did not clearly map to published services: ${replyPreview}`);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/quota|429|rate.?limit/i.test(message)) {
          replyPreview = `(gemini quota skipped) ${message.slice(0, 80)}`;
        } else {
          issues.push(`gemini error: ${message.slice(0, 120)}`);
        }
      }
    }

    const status = issues.length ? "FAIL" : "PASS";
    if (issues.length) fail += 1;
    else pass += 1;

    console.log(
      `[${status}] ${testCase.id} intent=${result.analysis.intent} docs=${result.documents.length} pass=${result.diagnostic.retrievalPass} web=${result.diagnostic.websiteSearchUsed} types=[${types.join(",")}] source=${result.diagnostic.knowledgeSource}`,
    );
    if (replyPreview) console.log(`  reply: ${replyPreview}`);
    for (const issue of issues) console.log(`  - ${issue}`);
  }

  console.log(`\nSummary: ${pass} PASS / ${fail} FAIL\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
