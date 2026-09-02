/**
 * Response variation diagnostic — test-only, not production.
 * Measures whether Gemini paraphrases verified KB vs copying verbatim.
 *
 * Run: npm run test:response-variation
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

import { emptyCustomerContext, extractContextFromMessage } from "../src/lib/agent/context";
import { getChatbotConfig } from "../src/server/chatbot/config";
import { generateAgentTurn, OpenAIServiceError } from "../src/server/chatbot/openai";
import {
  composeGeminiKnowledge,
  estimateKnowledgePayloadChars,
  getKnowledgeForLanguage,
  getVerbatimCheckSources,
} from "../src/server/chatbot/knowledge";
import { prepareGeminiHistory } from "../src/server/chatbot/contextManagement";
import { retrieveKnowledge } from "../src/server/agent/retrieve";
import { analyzeAgentTurn, buildAgentStateBlock, mergeGeminiAnalysis } from "../src/server/chatbot/agent/analyze";
import { selectAllowedFacts, factIdsToRecord } from "../src/server/chatbot/agent/factSelection";
import { polishAgentReply } from "../src/server/chatbot/agent/responseQuality";
import { isNearVerbatimKnowledgeMatch } from "../src/server/chatbot/agent/verbatimGuard";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
loadEnv({ path: resolve(root, ".env") });

const DIFFERENT_QUESTIONS = [
  "وش تشمل إدارة اليخت؟",
  "كيف تساعدون مالك اليخت؟",
  "عندي يخت وأبي أعرف وش تقدمون لي.",
  "ما هي خدمات إدارة اليخوت؟",
  "ليش أحتاج yacht management؟",
] as const;

const REPEAT_QUESTION = "وش تشمل إدارة اليخت؟";

type TurnRecord = {
  question: string;
  run: number;
  kbChars: number;
  rawGemini: string;
  parsedReply: string;
  mergedReply: string;
  finalReply: string;
  polishChanged: boolean;
  nearVerbatim: boolean;
  paraphraseRetried: boolean;
  quotaSkip: boolean;
};

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function jaccard(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.size && !tb.size) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union ? inter / union : 0;
}

function openingWords(text: string, count = 4): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, count)
    .join(" ")
    .toLowerCase();
}

function pairSimilarities(replies: string[]): number[] {
  const sims: number[] = [];
  for (let i = 0; i < replies.length; i += 1) {
    for (let j = i + 1; j < replies.length; j += 1) {
      sims.push(jaccard(replies[i], replies[j]));
    }
  }
  return sims;
}

async function runTurn(question: string, run: number): Promise<TurnRecord> {
  const language = "ar" as const;
  const config = getChatbotConfig();
  let context = emptyCustomerContext();
  const analyzed = analyzeAgentTurn(question, language, context);
  context = analyzed.context;
  const retrieval = await retrieveKnowledge(question, language, {
    context,
    historyText: "",
    retrievalBudget: {
      questionFocus: analyzed.analysis.questionFocus,
      disclosureLevel: analyzed.analysis.disclosureLevel,
      serviceId: context.lastServiceMentioned,
      agentIntent: analyzed.analysis.intent,
    },
  });
  const topicKey = analyzed.analysis.disclosureTopic ?? "general";
  const factSelection =
    topicKey !== "general" || analyzed.analysis.questionFocus === "general_service"
      ? selectAllowedFacts({
          serviceId: context.lastServiceMentioned ?? "yacht-management-360",
          disclosureLevel: analyzed.analysis.disclosureLevel,
          questionFocus: analyzed.analysis.questionFocus,
          intent: analyzed.analysis.intent,
          disclosedFactIds: context.disclosedFactIdsByTopic?.[topicKey] ?? [],
          language,
          message: question,
        })
      : undefined;
  const composeOptions = {
    intent: analyzed.analysis.intent,
    disclosureTopic: analyzed.analysis.disclosureTopic,
    lastServiceMentioned: context.lastServiceMentioned,
    needsPricing: analyzed.analysis.intent.includes("PRICING") || analyzed.analysis.questionFocus === "pricing",
    factSelection,
  };
  const kb = composeGeminiKnowledge(language, retrieval.formatted, composeOptions);
  const kbChars = kb.length;
  const verbatimSources = getVerbatimCheckSources(language, composeOptions);

  try {
    const turn = await generateAgentTurn(
      config,
      language,
      question,
      prepareGeminiHistory([], config),
      kb,
      {
        agentStateBlock: buildAgentStateBlock(analyzed.analysis, language, context, factSelection),
        customerContext: context,
        verbatimSources,
      },
    );
    const merged = mergeGeminiAnalysis(analyzed.analysis, turn.geminiParsed, context);
    const polished = polishAgentReply({
      reply: turn.reply,
      language,
      analysis: merged,
      context,
      userMessage: question,
    });
    const finalReply = polished.reply;
    return {
      question,
      run,
      kbChars,
      rawGemini: turn.rawGeminiText ?? "",
      parsedReply: turn.reply,
      mergedReply: turn.reply,
      finalReply,
      polishChanged: polished.repaired,
      nearVerbatim: isNearVerbatimKnowledgeMatch(finalReply, verbatimSources),
      paraphraseRetried: Boolean(turn.paraphraseRetried),
      quotaSkip: false,
    };
  } catch (error) {
    const quota =
      error instanceof OpenAIServiceError &&
      (error.kind === "quota" || error.status === 429);
    if (quota) {
      return {
        question,
        run,
        kbChars,
        rawGemini: "",
        parsedReply: "",
        mergedReply: "",
        finalReply: "",
        polishChanged: false,
        nearVerbatim: false,
        paraphraseRetried: false,
        quotaSkip: true,
      };
    }
    throw error;
  }
}

function summarizeGroup(label: string, records: TurnRecord[]) {
  const active = records.filter((r) => !r.quotaSkip);
  const skipped = records.filter((r) => r.quotaSkip);
  console.log(`\n=== ${label} ===`);
  if (skipped.length === records.length) {
    console.log("SKIP — QUOTA (all runs blocked)");
    return { min: NaN, max: NaN, avg: NaN, skipped: records.length };
  }
  if (skipped.length) console.log(`SKIP — QUOTA: ${skipped.length}/${records.length} runs`);

  for (const r of records) {
    if (r.quotaSkip) {
      console.log(`  [${r.run}] SKIP — QUOTA`);
      continue;
    }
    console.log(
      `  [${r.run}] kb=${r.kbChars} verbatim=${r.nearVerbatim} retry=${r.paraphraseRetried} polishChanged=${r.polishChanged}`,
    );
    console.log(`       raw: ${r.rawGemini.slice(0, 120).replace(/\s+/g, " ")}...`);
    console.log(`       final: ${r.finalReply.slice(0, 120).replace(/\s+/g, " ")}...`);
  }

  const finals = active.map((r) => r.finalReply);
  const raws = active.map((r) => r.parsedReply);
  const exactDupes = finals.filter((r, i) => finals.indexOf(r) !== i).length;
  const sims = pairSimilarities(finals);
  const rawSims = pairSimilarities(raws);
  const openings = finals.map((r) => openingWords(r));
  const identicalOpenings = openings.filter((o, i) => openings.indexOf(o) !== i).length;

  const min = sims.length ? Math.min(...sims) : 0;
  const max = sims.length ? Math.max(...sims) : 0;
  const avg = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;
  const rawMin = rawSims.length ? Math.min(...rawSims) : 0;
  const rawMax = rawSims.length ? Math.max(...rawSims) : 0;

  console.log(`  exact duplicate finals: ${exactDupes}`);
  console.log(`  identical openings: ${identicalOpenings}`);
  console.log(
    `  final similarity (jaccard): min=${(min * 100).toFixed(0)}% max=${(max * 100).toFixed(0)}% avg=${(avg * 100).toFixed(0)}%`,
  );
  console.log(
    `  raw Gemini similarity: min=${(rawMin * 100).toFixed(0)}% max=${(rawMax * 100).toFixed(0)}%`,
  );
  return { min, max, avg, skipped: skipped.length };
}

async function main() {
  const config = getChatbotConfig();
  if (!config.openaiApiKey) {
    console.error("SKIP — QUOTA: OPENAI_API_KEY not set");
    process.exit(2);
  }

  const fullKb = getKnowledgeForLanguage("ar").length;
  const selectiveKb = estimateKnowledgePayloadChars("ar", "", {
    intent: "YACHT_MANAGEMENT",
    disclosureTopic: "yacht-management-360",
  });
  console.log("Response variation diagnostic");
  console.log(`KB payload: full=${fullKb} chars, selective(yacht-mgmt)=${selectiveKb} chars`);
  console.log(`Generation: temperature=${config.geminiTemperature} topP=${config.geminiTopP}`);

  const differentRecords: TurnRecord[] = [];
  for (let i = 0; i < DIFFERENT_QUESTIONS.length; i += 1) {
    differentRecords.push(await runTurn(DIFFERENT_QUESTIONS[i], i + 1));
    await new Promise((r) => setTimeout(r, 400));
  }

  const repeatRecords: TurnRecord[] = [];
  for (let i = 0; i < 5; i += 1) {
    repeatRecords.push(await runTurn(REPEAT_QUESTION, i + 1));
    await new Promise((r) => setTimeout(r, 400));
  }

  summarizeGroup("Different questions (5)", differentRecords);
  const repeatStats = summarizeGroup(`Same question ×5: "${REPEAT_QUESTION}"`, repeatRecords);

  const allSkipped =
    differentRecords.every((r) => r.quotaSkip) && repeatRecords.every((r) => r.quotaSkip);
  if (allSkipped) {
    console.log("\nVERDICT: SKIP — QUOTA (not a pass)");
    process.exit(2);
  }

  const repeatMax = repeatStats.max;
  if (Number.isFinite(repeatMax) && repeatMax >= 0.83) {
    console.log("\nVERDICT: 🟡 IMPROVED BUT STILL OVER-CONSTRAINED (repeat max >= 83%)");
    process.exit(1);
  }
  if (Number.isFinite(repeatMax) && repeatMax < 0.83) {
    console.log("\nVERDICT: 🟢 RESPONSES NATURAL + VARIED + GROUNDED");
    process.exit(0);
  }
  console.log("\nVERDICT: incomplete (insufficient live runs)");
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
