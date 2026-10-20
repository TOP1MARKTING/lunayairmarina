/**
 * Deterministic fact-selection and information-budget tests (no live Gemini).
 * Run: npm run test:fact-selection
 */
import { emptyCustomerContext } from "../src/lib/agent/context";
import { analyzeAgentTurn } from "../src/server/chatbot/agent/analyze";
import {
  factIdsToRecord,
  getAllServiceFactTexts,
  resolveQuestionFocus,
  selectAllowedFacts,
} from "../src/server/chatbot/agent/factSelection";
import { composeGeminiKnowledge } from "../src/server/chatbot/knowledge";
import { retrieveKnowledge } from "../src/server/agent/retrieve";
import { recordDisclosedFactIds } from "../src/server/chatbot/agent/antiRepetition";

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string) {
  if (!condition) {
    failed += 1;
    console.error(`FAIL: ${message}`);
    return;
  }
  passed += 1;
}

const base = {
  serviceId: "yacht-management-360",
  intent: "YACHT_MANAGEMENT",
  disclosedFactIds: [] as string[],
  language: "ar" as const,
  message: "",
};

async function run() {
  console.log("Running fact-selection tests...\n");

  assert(resolveQuestionFocus("وش تشمل إدارة اليخت؟") === "scope_overview", "focus: scope ar");
  assert(resolveQuestionFocus("what includes yacht management") === "scope_overview", "focus: scope en");
  assert(resolveQuestionFocus("وش يشمل من ناحية التشغيل؟") === "operational", "focus: operational ar");
  assert(resolveQuestionFocus("day-to-day operations") === "operational", "focus: operational en");
  assert(resolveQuestionFocus("بكم إدارة اليخت؟") === "pricing", "focus: pricing ar");
  assert(resolveQuestionFocus("what is the cost") === "pricing", "focus: pricing en");
  assert(resolveQuestionFocus("الفرق بين إدارة اليخت والمارينا") === "comparison", "focus: comparison");
  assert(resolveQuestionFocus("كيف تساعدون مالك اليخت؟") === "owner_value", "focus: owner_value");
  assert(resolveQuestionFocus("وش بعد؟") === "progressive_expand", "focus: progressive_expand");

  const l1 = selectAllowedFacts({
    ...base,
    disclosureLevel: 1,
    questionFocus: "scope_overview",
    message: "وش تشمل إدارة اليخت؟",
  });
  assert(l1.allowedFactIds.length >= 4 && l1.allowedFactIds.length <= 6, "L1: theme count bounded");
  assert(l1.hiddenFactIds.length === 9, "L1: all ym360 facts hidden");
  assert(!l1.allowedFactIds.some((id) => id.startsWith("ym360_")), "L1: no ym360 fact IDs exposed");
  const l1Payload = composeGeminiKnowledge("ar", "", { intent: "YACHT_MANAGEMENT", factSelection: l1 });
  assert(!l1Payload.includes('"includes"'), "L1 payload: no includes array");
  assert(!l1Payload.includes("إدارة التجديد"), "L1 payload: hidden refit prose absent");
  assert(l1Payload.includes("allowedFacts"), "L1 payload: allowedFacts block present");
  assert(!l1Payload.includes("hiddenFactIds"), "L1 payload: hiddenFactIds not sent to Gemini");

  const message = "وش تشمل إدارة اليخت؟";
  const analyzed = analyzeAgentTurn(message, "ar", emptyCustomerContext());
  const selection = selectAllowedFacts({
    serviceId: "yacht-management-360",
    disclosureLevel: analyzed.analysis.disclosureLevel,
    questionFocus: analyzed.analysis.questionFocus,
    intent: analyzed.analysis.intent,
    disclosedFactIds: [],
    language: "ar",
    message,
  });
  const retrieval = await retrieveKnowledge(message, "ar", {
    context: analyzed.context,
    retrievalBudget: {
      questionFocus: analyzed.analysis.questionFocus,
      disclosureLevel: analyzed.analysis.disclosureLevel,
      serviceId: "yacht-management-360",
      agentIntent: analyzed.analysis.intent,
    },
  });
  assert(retrieval.diagnostic.selected.length <= 1, "L1 retrieval: max 1 doc");
  const pipelinePayload = composeGeminiKnowledge("ar", retrieval.formatted, {
    intent: analyzed.analysis.intent,
    factSelection: selection,
  });
  const hiddenBullets = getAllServiceFactTexts("yacht-management-360", "ar");
  const hiddenHits = hiddenBullets.filter((b) => pipelinePayload.includes(b));
  assert(hiddenHits.length === 0, "L1 full pipeline: no hidden bullet prose in payload");
  assert(!pipelinePayload.includes('"includes"'), "L1 full pipeline: no includes array");

  let memCtx = emptyCustomerContext();
  const memT1 = analyzeAgentTurn("وش تشمل إدارة اليخت؟", "ar", memCtx);
  memCtx = memT1.context;
  const memSel1 = selectAllowedFacts({
    serviceId: "yacht-management-360",
    disclosureLevel: memT1.analysis.disclosureLevel,
    questionFocus: memT1.analysis.questionFocus,
    intent: memT1.analysis.intent,
    disclosedFactIds: [],
    language: "ar",
    message: "وش تشمل إدارة اليخت؟",
  });
  memCtx = recordDisclosedFactIds(memCtx, "yacht-management-360", factIdsToRecord(memSel1));
  assert((memCtx.disclosedFactIdsByTopic?.["yacht-management-360"]?.length ?? 0) > 0, "fact memory persisted");
  const memT2 = analyzeAgentTurn("وش بعد؟", "ar", memCtx);
  const memSel2 = selectAllowedFacts({
    serviceId: "yacht-management-360",
    disclosureLevel: memT2.analysis.disclosureLevel,
    questionFocus: memT2.analysis.questionFocus,
    intent: memT2.analysis.intent,
    disclosedFactIds: memCtx.disclosedFactIdsByTopic?.["yacht-management-360"] ?? [],
    language: "ar",
    message: "وش بعد؟",
  });
  const memNew = memSel2.allowedFactIds.filter((id) => id.startsWith("ym360_"));
  assert(
    memNew.every((id) => !(memCtx.disclosedFactIdsByTopic?.["yacht-management-360"] ?? []).includes(id)),
    "progressive: new facts not in disclosed set",
  );

  const legacyCtx = {
    ...emptyCustomerContext(),
    disclosureByTopic: { "yacht-management-360": 1 },
    lastServiceMentioned: "yacht-management-360",
  };
  const legacyTurn = analyzeAgentTurn("وش بعد؟", "ar", legacyCtx);
  assert(legacyTurn.analysis.disclosureLevel === 2, "legacy context without fact IDs still advances disclosure");

  const l1Recorded = factIdsToRecord(l1);
  const l2 = selectAllowedFacts({
    ...base,
    disclosureLevel: 2,
    questionFocus: "progressive_expand",
    disclosedFactIds: l1Recorded,
    message: "وش بعد؟",
  });
  const l2Facts = l2.allowedFactIds.filter((id) => id.startsWith("ym360_"));
  assert(l2Facts.length <= 4, "L2: <= 4 new fact IDs");
  assert(l2Facts.every((id) => !l1Recorded.includes(id)), "L2: no duplicate disclosure");

  const l2Recorded = [...l1Recorded, ...factIdsToRecord(l2)];
  const l3 = selectAllowedFacts({
    ...base,
    disclosureLevel: 3,
    questionFocus: "progressive_expand",
    disclosedFactIds: l2Recorded,
    message: "تفاصيل أكثر",
  });
  assert(!l3.allowedFacts.some((f) => f.kind === "pricing"), "L3 expand: no pricing unless pricing focus");
  assert(l3.allowedFactIds.filter((id) => id.startsWith("ym360_")).length <= 5, "L3: <= 5 facts");

  const op = selectAllowedFacts({
    ...base,
    disclosureLevel: 3,
    questionFocus: "operational",
    disclosedFactIds: l2Recorded,
    message: "وش يشمل من ناحية التشغيل؟",
  });
  assert(
    op.allowedFactIds.some((id) =>
      ["ym360_benefit_0", "ym360_feature_0", "ym360_value_0"].includes(id),
    ),
    "operational: operational facts selected",
  );
  assert(!op.allowedFacts.some((f) => f.kind === "pricing"), "operational: no pricing facts");

  const pr = selectAllowedFacts({
    ...base,
    disclosureLevel: 3,
    questionFocus: "pricing",
    intent: "YACHT_MANAGEMENT_PRICING",
    disclosedFactIds: l2Recorded,
    message: "بكم إدارة اليخت؟",
  });
  assert(pr.allowedFacts.some((f) => f.kind === "pricing"), "pricing: pricing policy available");
  assert(pr.hiddenFactIds.length >= 6, "pricing: service bullet facts hidden");

  const d1 = selectAllowedFacts({
    ...base,
    disclosureLevel: 1,
    questionFocus: "scope_overview",
    message: "وش تشمل؟",
  });
  const d2 = selectAllowedFacts({
    ...base,
    disclosureLevel: 1,
    questionFocus: "scope_overview",
    message: "وش تشمل؟",
  });
  assert(JSON.stringify(d1.allowedFactIds) === JSON.stringify(d2.allowedFactIds), "deterministic fact IDs");

  let ctx = emptyCustomerContext();
  const t1 = analyzeAgentTurn("وش تشمل إدارة اليخت؟", "ar", ctx);
  ctx = t1.context;
  assert(t1.analysis.disclosureLevel === 1, "progressive T1: L1");
  assert(t1.analysis.questionFocus === "scope_overview", "progressive T1: scope focus");

  const sel1 = selectAllowedFacts({
    serviceId: "yacht-management-360",
    disclosureLevel: t1.analysis.disclosureLevel,
    questionFocus: t1.analysis.questionFocus,
    intent: t1.analysis.intent,
    disclosedFactIds: ctx.disclosedFactIdsByTopic?.["yacht-management-360"] ?? [],
    language: "ar",
    message: "وش تشمل إدارة اليخت؟",
  });
  ctx = {
    ...ctx,
    disclosedFactIdsByTopic: {
      "yacht-management-360": factIdsToRecord(sel1),
    },
  };

  const t2 = analyzeAgentTurn("وش بعد؟", "ar", ctx);
  assert(t2.analysis.disclosureLevel === 2, "progressive T2: L2");
  const sel2 = selectAllowedFacts({
    serviceId: "yacht-management-360",
    disclosureLevel: t2.analysis.disclosureLevel,
    questionFocus: t2.analysis.questionFocus,
    intent: t2.analysis.intent,
    disclosedFactIds: ctx.disclosedFactIdsByTopic?.["yacht-management-360"] ?? [],
    language: "ar",
    message: "وش بعد؟",
  });
  const newIds2 = sel2.allowedFactIds.filter((id) => id.startsWith("ym360_"));
  assert(newIds2.length <= 4, "progressive T2: <= 4 new facts");

  const t3 = analyzeAgentTurn("تفاصيل أكثر", "ar", {
    ...t2.context,
    disclosedFactIdsByTopic: {
      "yacht-management-360": [...factIdsToRecord(sel1), ...factIdsToRecord(sel2)],
    },
  });
  assert(t3.analysis.disclosureLevel === 3, "progressive T3: L3");

  const t4 = analyzeAgentTurn("وش يشمل من ناحية التشغيل؟", "ar", t3.context);
  const sel4 = selectAllowedFacts({
    serviceId: "yacht-management-360",
    disclosureLevel: t4.analysis.disclosureLevel,
    questionFocus: t4.analysis.questionFocus,
    intent: t4.analysis.intent,
    disclosedFactIds: t3.context.disclosedFactIdsByTopic?.["yacht-management-360"] ?? [],
    language: "ar",
    message: "وش يشمل من ناحية التشغيل؟",
  });
  assert(t4.analysis.questionFocus === "operational", "progressive T4: operational focus");
  assert(!sel4.allowedFacts.some((f) => f.kind === "pricing"), "progressive T4: no pricing at operational");

  console.log(`\nFact-selection: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
