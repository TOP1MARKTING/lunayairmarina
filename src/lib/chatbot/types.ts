export type ChatLanguage = "ar" | "en";

export type ChatRole = "user" | "assistant";

export interface ChatHistoryItem {
  role: ChatRole;
  content: string;
}

/** Client payload — history is ignored; server loads from Firestore by sessionId. */
export interface ChatClientPayload {
  message: string;
  language: ChatLanguage;
  sessionId: string;
  /** Legacy clients may still send history; server ignores it for validation and context. */
  history?: ChatHistoryItem[];
}

export interface ChatRequest {
  message: string;
  language: ChatLanguage;
  sessionId: string;
  history: ChatHistoryItem[];
}

export type ChatErrorCode =
  | "VALIDATION"
  | "RATE_LIMIT"
  | "AI"
  | "GEMINI"
  | "FIRESTORE"
  | "CONTEXT"
  | "TIMEOUT"
  | "CONFIG"
  | "INTERNAL";

export interface ChatSuccessResponse {
  ok: true;
  reply: string;
}

export interface ChatErrorResponse {
  ok: false;
  code: ChatErrorCode;
}

export type ChatResponse = ChatSuccessResponse | ChatErrorResponse;
