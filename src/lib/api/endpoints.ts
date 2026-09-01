/**
 * Stable logical names for server-side capabilities.
 * HTTP mode uses /api/v1/* (future Firebase Functions contract).
 * server-fn mode uses TanStack Start RPC against VITE_API_BASE_URL.
 */
export const API_OPERATIONS = {
  chatbotSendMessage: "chatbotSendMessage",
  chatbotSubmitContact: "chatbotSubmitContact",
  aiTriggerKnowledgeSync: "aiTriggerKnowledgeSync",
  aiDeleteConversation: "aiDeleteConversation",
  aiDeleteAllConversations: "aiDeleteAllConversations",
  adminSetUserPassword: "adminSetUserPassword",
} as const;

export type ApiOperation = (typeof API_OPERATIONS)[keyof typeof API_OPERATIONS];

/** REST paths when proxying through the SSR host (legacy / optional). */
export const HTTP_API_PATHS: Record<ApiOperation, string> = {
  chatbotSendMessage: "/api/v1/chatbot/message",
  chatbotSubmitContact: "/api/v1/chatbot/contact",
  aiTriggerKnowledgeSync: "/api/v1/admin/ai/knowledge-sync",
  aiDeleteConversation: "/api/v1/admin/ai/conversations/delete",
  aiDeleteAllConversations: "/api/v1/admin/ai/conversations/delete-all",
  adminSetUserPassword: "/api/v1/admin/users/set-password",
};

/** Firebase Cloud Functions export names (Gen2 HTTPS). */
export const FIREBASE_FUNCTION_NAMES: Record<ApiOperation, string> = {
  chatbotSendMessage: "chatbotSendMessage",
  chatbotSubmitContact: "chatbotSubmitContact",
  aiTriggerKnowledgeSync: "aiTriggerKnowledgeSync",
  aiDeleteConversation: "aiDeleteConversation",
  aiDeleteAllConversations: "aiDeleteAllConversations",
  adminSetUserPassword: "adminSetUserPassword",
};

/**
 * TanStack Start server function IDs on the production Vercel host (content hashes).
 * Sourced from scripts/prod-smoke-firebase.ts and probe scripts; re-verify after major upgrades.
 */
export const TANSTACK_SERVER_FUNCTION_IDS: Record<ApiOperation, string> = {
  chatbotSendMessage: "8c3a24bfc2c03a6dbfec2ea9285c2a0884d1f92e8df4a37e1e4d4d4fd0e5b57a",
  chatbotSubmitContact: "71ee1b2d5bcee28397bac002390976f1aae24bf2ed21859bff6241cc56524269",
  aiTriggerKnowledgeSync: "f0495a528fb95f3f8374c1a04dce150b578189c3d60af2ba68bd2bd28754516e",
  aiDeleteConversation: "50b5eb35c7ba0b732b965815f63aa01c5b2de7ee356d7493bfd13b7a608fbdb7",
  aiDeleteAllConversations: "a71ca7de25694d53eca41cc09cfde2d850cefbae693608e623eeb5fe184b3c53",
  adminSetUserPassword: "35e0407e5e6334e243cb986eab0e3b5827b2841dc713559118d4c9c64d0da522",
};
