import type { ChatHistoryItem, ChatLanguage } from "@/lib/chatbot/types";
import type { CustomerContext } from "@/lib/agent/context";
import type { ChatbotConfig } from "./config";
import { buildSystemPrompt } from "./prompt";
import { shrinkLlmHistoryForRetry } from "./contextManagement";
import { extractUserFacingReply, parseGeminiAgentOutputDetailed } from "./agent/parseOutput";
import type { AgentTurnResult } from "./agent/types";
import {
  isNearVerbatimKnowledgeMatch,
  PARAPHRASE_RETRY_HINT,
} from "./agent/verbatimGuard";

export type LlmAgentContext = {
  conversationSummary?: string;
  customerContext?: CustomerContext;
  offerHandoff?: boolean;
  needsContactCapture?: boolean;
  contactAlreadyAsked?: boolean;
  agentStateBlock?: string;
  jsonMode?: boolean;
  /** KB snippets for near-verbatim detection (quality control). */
  verbatimSources?: string[];
  paraphraseRetryDone?: boolean;
};

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

export class OpenAIServiceError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly kind: "quota" | "context" | "timeout" | "api" | "empty" | "network";

  constructor(
    message: string,
    options: { retryable: boolean; status?: number; kind?: OpenAIServiceError["kind"] },
  ) {
    super(message);
    this.name = "OpenAIServiceError";
    this.retryable = options.retryable;
    this.status = options.status;
    this.kind = options.kind ?? "api";
  }
}

export function extractOpenAIResponseText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as OpenAIChatResponse).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = choices[0]?.message?.content;
  if (typeof content !== "string") return null;
  const text = content.trim();
  return text.length > 0 ? text : null;
}

function classifyOpenAIFailure(status: number, message: string): OpenAIServiceError["kind"] {
  if (status === 429) return "quota";
  if (status === 408) return "timeout";
  if (status === 400 && /context|token|length|too large|exceed|maximum context/i.test(message)) {
    return "context";
  }
  return "api";
}

function toOpenAIHistory(history: ChatHistoryItem[]): OpenAIChatMessage[] {
  return history.map((item) => ({
    role: item.role === "assistant" ? "assistant" : "user",
    content: item.content,
  }));
}

async function callOpenAIOnce(
  config: ChatbotConfig,
  language: ChatLanguage,
  message: string,
  history: ChatHistoryItem[],
  retrievedKnowledge: string,
  agentContext?: LlmAgentContext,
): Promise<string> {
  const url = "https://api.openai.com/v1/chat/completions";
  const jsonMode = agentContext?.jsonMode !== false;

  const messages: OpenAIChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(language, retrievedKnowledge, {
        conversationSummary: agentContext?.conversationSummary,
        customerContext: agentContext?.customerContext,
        offerHandoff: agentContext?.offerHandoff,
        needsContactCapture: agentContext?.needsContactCapture,
        contactAlreadyAsked: agentContext?.contactAlreadyAsked,
        agentStateBlock: agentContext?.agentStateBlock,
      }),
    },
    ...toOpenAIHistory(history),
    { role: "user", content: message },
  ];

  const body: Record<string, unknown> = {
    model: config.openaiModel,
    messages,
    max_tokens: config.maxOutputTokens,
    temperature: config.llmTemperature,
    top_p: config.llmTopP,
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    let payload: OpenAIChatResponse;
    try {
      payload = (await response.json()) as OpenAIChatResponse;
    } catch {
      throw new OpenAIServiceError("Invalid OpenAI response", { retryable: false, kind: "empty" });
    }

    if (!response.ok) {
      const errorMessage = payload.error?.message ?? `OpenAI request failed (${response.status})`;
      const kind = classifyOpenAIFailure(response.status, errorMessage);
      const contextOverflow = kind === "context";
      const retryable =
        response.status === 429 || response.status >= 500 || contextOverflow;
      throw new OpenAIServiceError(errorMessage, { retryable, status: response.status, kind });
    }

    const text = extractOpenAIResponseText(payload);
    if (!text) {
      throw new OpenAIServiceError("Empty OpenAI response", { retryable: false, kind: "empty" });
    }

    return text;
  } catch (error) {
    if (error instanceof OpenAIServiceError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OpenAIServiceError("OpenAI request timed out", {
        retryable: true,
        kind: "timeout",
        status: 408,
      });
    }
    throw new OpenAIServiceError("OpenAI network error", { retryable: true, kind: "network" });
  } finally {
    clearTimeout(timeout);
  }
}

function extractReplyFromRaw(raw: string): {
  reply: string;
  parsed: AgentTurnResult["geminiParsed"];
  parsedResult: ReturnType<typeof parseGeminiAgentOutputDetailed>;
} {
  const parsedResult = parseGeminiAgentOutputDetailed(raw);
  const parsed = parsedResult.output;
  const reply =
    parsed?.reply?.trim() ||
    parsedResult.reply?.trim() ||
    extractUserFacingReply(raw);
  return { reply: reply?.trim() ?? "", parsed, parsedResult };
}

export async function generateChatReply(
  config: ChatbotConfig,
  language: ChatLanguage,
  message: string,
  history: ChatHistoryItem[],
  retrievedKnowledge: string,
  agentContext?: LlmAgentContext,
): Promise<string> {
  const turn = await generateAgentTurn(
    config,
    language,
    message,
    history,
    retrievedKnowledge,
    agentContext,
  );
  return turn.reply;
}

export async function generateAgentTurn(
  config: ChatbotConfig,
  language: ChatLanguage,
  message: string,
  history: ChatHistoryItem[],
  retrievedKnowledge: string,
  agentContext?: LlmAgentContext,
): Promise<AgentTurnResult> {
  if (!config.openaiApiKey) {
    throw new OpenAIServiceError("OpenAI API key is not configured", {
      retryable: false,
      kind: "api",
    });
  }

  const run = async (ctx: LlmAgentContext | undefined) =>
    callOpenAIOnce(config, language, message, history, retrievedKnowledge, ctx);

  let raw: string;
  let paraphraseRetried = false;
  let nearVerbatimDetected = false;
  try {
    raw = await run(agentContext);
  } catch (error) {
    if (error instanceof OpenAIServiceError && error.retryable) {
      const trimmedHistory =
        error.status === 400 ? shrinkLlmHistoryForRetry(history) : history;
      try {
        raw = await callOpenAIOnce(
          config,
          language,
          message,
          trimmedHistory,
          retrievedKnowledge,
          agentContext,
        );
      } catch (retryError) {
        if (
          retryError instanceof OpenAIServiceError &&
          retryError.status === 400 &&
          agentContext?.jsonMode !== false
        ) {
          raw = await callOpenAIOnce(
            config,
            language,
            message,
            trimmedHistory,
            retrievedKnowledge,
            { ...agentContext, jsonMode: false },
          );
        } else {
          throw retryError;
        }
      }
    } else if (
      error instanceof OpenAIServiceError &&
      error.status === 400 &&
      agentContext?.jsonMode !== false
    ) {
      raw = await run({ ...agentContext, jsonMode: false });
    } else {
      throw error;
    }
  }

  let { reply, parsed, parsedResult } = extractReplyFromRaw(raw);

  const verbatimSources = agentContext?.verbatimSources ?? [];
  if (
    reply &&
    verbatimSources.length > 0 &&
    isNearVerbatimKnowledgeMatch(reply, verbatimSources) &&
    !agentContext?.paraphraseRetryDone
  ) {
    nearVerbatimDetected = true;
    const hint = PARAPHRASE_RETRY_HINT[language === "ar" ? "ar" : "en"];
    const retryContext: LlmAgentContext = {
      ...agentContext,
      paraphraseRetryDone: true,
      agentStateBlock: [agentContext?.agentStateBlock?.trim(), hint].filter(Boolean).join("\n\n"),
    };
    try {
      const retryRaw = await run(retryContext);
      const retryExtracted = extractReplyFromRaw(retryRaw);
      if (retryExtracted.reply) {
        raw = retryRaw;
        reply = retryExtracted.reply;
        parsed = retryExtracted.parsed;
        parsedResult = retryExtracted.parsedResult;
        paraphraseRetried = true;
      }
    } catch {
      // Keep first reply — no infinite retry loop
    }
  }

  if (!reply?.trim()) {
    throw new OpenAIServiceError("Empty OpenAI response", { retryable: false, kind: "empty" });
  }

  return {
    reply,
    rawGeminiText: raw,
    paraphraseRetried,
    nearVerbatimDetected,
    geminiParsed: parsed,
    structuredParseFailed: parsedResult.status === "failed",
    parseStatus: parsedResult.status,
    parseErrors: parsedResult.errors,
    salvageMethod: parsedResult.salvageMethod,
    analysis: {
      intent: parsed?.intent ?? "GENERAL",
      secondaryIntents: parsed?.secondaryIntents ?? [],
      conversationStage: "DISCOVERY",
      commercialScore: parsed?.commercialScore ?? 0,
      nextBestAction: "ANSWER",
      urgency: "LOW",
      entities: {},
      missingInformation: parsed?.missingInformation ?? [],
      leadSignals: parsed?.leadSignals ?? [],
      objections: [],
      buyingSignals: [],
      handoff: Boolean(parsed?.handoff),
      repair: false,
      progressive: false,
      shortQuery: false,
      security: false,
      gibberish: false,
      disclosureLevel: 0,
      questionFocus: "general_service",
    },
  };
}
