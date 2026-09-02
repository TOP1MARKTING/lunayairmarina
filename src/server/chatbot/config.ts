/** Server-only chatbot configuration. Never import from client components. */

import { readServerEnv } from "@/server/env";

export const CHATBOT_DEFAULTS = {
  maxMessageLength: 1000,
  /** Recent messages sent to the LLM (not a user-facing conversation cap). */
  llmMaxHistoryItems: 12,
  /** Token budget for multi-turn context (older turns rely on conversation summary). */
  llmHistoryTokenBudget: 6000,
  rateLimitWindowMs: 60_000,
  /**
   * Abuse protection only — NOT a conversation message cap.
   * Default allows ~2 msgs/sec sustained; normal chat should never hit this.
   * Override via CHATBOT_RATE_LIMIT_PER_MINUTE on Vercel (avoid legacy value 10).
   */
  rateLimitMaxRequests: 120,
  maxOutputTokens: 2048,
  requestTimeoutMs: 30_000,
  openaiModel: "gpt-4o-mini",
  /** Higher than 0.4 for natural paraphrase; still conservative for grounding. */
  llmTemperature: 0.6,
  llmTopP: 0.92,
} as const;

function readFloat(name: string, fallback: number, min: number, max: number): number {
  const raw = readServerEnv(name);
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = readServerEnv(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readIntWithLegacy(
  primary: string,
  legacy: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const primaryRaw = readServerEnv(primary);
  if (primaryRaw) return readInt(primary, fallback, min, max);
  return readInt(legacy, fallback, min, max);
}

function readFloatWithLegacy(
  primary: string,
  legacy: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const primaryRaw = readServerEnv(primary);
  if (primaryRaw) return readFloat(primary, fallback, min, max);
  return readFloat(legacy, fallback, min, max);
}

export function getChatbotConfig() {
  return {
    openaiApiKey: readServerEnv("OPENAI_API_KEY"),
    openaiModel: readServerEnv("OPENAI_MODEL") || CHATBOT_DEFAULTS.openaiModel,
    maxMessageLength: readInt(
      "CHATBOT_MAX_MESSAGE_LENGTH",
      CHATBOT_DEFAULTS.maxMessageLength,
      100,
      4000,
    ),
    llmMaxHistoryItems: readIntWithLegacy(
      "CHATBOT_LLM_HISTORY_ITEMS",
      "CHATBOT_GEMINI_HISTORY_ITEMS",
      CHATBOT_DEFAULTS.llmMaxHistoryItems,
      2,
      32,
    ),
    llmHistoryTokenBudget: readIntWithLegacy(
      "CHATBOT_LLM_HISTORY_TOKENS",
      "CHATBOT_GEMINI_HISTORY_TOKENS",
      CHATBOT_DEFAULTS.llmHistoryTokenBudget,
      1000,
      24_000,
    ),
    rateLimitWindowMs: readInt(
      "CHATBOT_RATE_LIMIT_WINDOW_MS",
      CHATBOT_DEFAULTS.rateLimitWindowMs,
      10_000,
      300_000,
    ),
    rateLimitMaxRequests: readInt(
      "CHATBOT_RATE_LIMIT_PER_MINUTE",
      CHATBOT_DEFAULTS.rateLimitMaxRequests,
      30,
      600,
    ),
    maxOutputTokens: readInt(
      "CHATBOT_MAX_OUTPUT_TOKENS",
      CHATBOT_DEFAULTS.maxOutputTokens,
      128,
      2048,
    ),
    requestTimeoutMs: readInt(
      "CHATBOT_REQUEST_TIMEOUT_MS",
      CHATBOT_DEFAULTS.requestTimeoutMs,
      5_000,
      120_000,
    ),
    llmTemperature: readFloatWithLegacy(
      "CHATBOT_LLM_TEMPERATURE",
      "CHATBOT_GEMINI_TEMPERATURE",
      CHATBOT_DEFAULTS.llmTemperature,
      0.1,
      1,
    ),
    llmTopP: readFloatWithLegacy(
      "CHATBOT_LLM_TOP_P",
      "CHATBOT_GEMINI_TOP_P",
      CHATBOT_DEFAULTS.llmTopP,
      0.5,
      1,
    ),
  };
}

export type ChatbotConfig = ReturnType<typeof getChatbotConfig>;
