import type { ChatHistoryItem } from "@/lib/chatbot/types";
import { estimateTokens } from "@/server/agent/normalize";
import type { ChatbotConfig } from "./config";

export function trimHistory(history: ChatHistoryItem[], maxItems: number): ChatHistoryItem[] {
  if (history.length <= maxItems) return history;
  return history.slice(-maxItems);
}

export function estimateHistoryTokens(history: ChatHistoryItem[]): number {
  return history.reduce((sum, item) => sum + estimateTokens(item.content), 0);
}

/**
 * Select recent turns for the LLM only. Full client history remains unlimited for
 * validation and Firestore persistence; older context is covered via conversation summary.
 */
export function prepareLlmHistory(
  history: ChatHistoryItem[],
  config: ChatbotConfig,
): ChatHistoryItem[] {
  let selected = trimHistory(history, config.llmMaxHistoryItems);

  const budget = config.llmHistoryTokenBudget;
  if (budget <= 0 || selected.length <= 2) return selected;

  while (selected.length > 2 && estimateHistoryTokens(selected) > budget) {
    selected = selected.slice(1);
  }

  return selected;
}

/** @deprecated Use prepareLlmHistory */
export const prepareGeminiHistory = prepareLlmHistory;

/**
 * Emergency trim when the LLM rejects context size — keeps at least one prior turn.
 */
export function shrinkLlmHistoryForRetry(history: ChatHistoryItem[]): ChatHistoryItem[] {
  if (history.length <= 4) {
    return history.slice(-Math.max(1, history.length - 1));
  }
  const half = Math.max(2, Math.floor(history.length / 2));
  return history.slice(-half);
}

/** @deprecated Use shrinkLlmHistoryForRetry */
export const shrinkGeminiHistoryForRetry = shrinkLlmHistoryForRetry;
