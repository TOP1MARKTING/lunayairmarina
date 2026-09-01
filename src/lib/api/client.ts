import { getApiTransport, usesRemoteServerFn } from "./config";
import type { ApiOperation } from "./endpoints";
import { callRemoteServerFn } from "./remoteServerFn";

export type ServerFnCallArgs<TData> = {
  data: TData;
  headers?: HeadersInit;
};

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function callHttpRestApi<TData, TResult>(
  operation: ApiOperation,
  args: ServerFnCallArgs<TData>,
): Promise<TResult> {
  const { getHttpApiUrl } = await import("@/lib/api/config.firebaseHttp");
  const url = getHttpApiUrl(operation);
  const headers = new Headers(args.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("accept", "application/json");

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(args.data),
    credentials: "omit",
  });

  const body = await parseResponseBody(response);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error?: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as TResult;
}

async function callLocalServerFn<TData, TResult>(
  operation: ApiOperation,
  args: ServerFnCallArgs<TData>,
): Promise<TResult> {
  switch (operation) {
    case "chatbotSendMessage": {
      const { sendChatbotMessage } = await import("@/functions/chatbot");
      return sendChatbotMessage(args) as Promise<TResult>;
    }
    case "chatbotSubmitContact": {
      const { submitChatbotContact } = await import("@/functions/chatbot");
      return submitChatbotContact(args) as Promise<TResult>;
    }
    case "aiTriggerKnowledgeSync": {
      const { triggerKnowledgeSync } = await import("@/functions/aiAdmin");
      return triggerKnowledgeSync({ data: args.data }) as Promise<TResult>;
    }
    case "aiDeleteConversation": {
      const { deleteAiConversation } = await import("@/functions/aiAdmin");
      return deleteAiConversation(args) as Promise<TResult>;
    }
    case "aiDeleteAllConversations": {
      const { deleteAllAiConversations } = await import("@/functions/aiAdmin");
      return deleteAllAiConversations({ data: args.data }) as Promise<TResult>;
    }
    case "adminSetUserPassword": {
      const { setAdminUserPassword } = await import("@/functions/adminUsers");
      return setAdminUserPassword(args) as Promise<TResult>;
    }
    default: {
      const exhaustive: never = operation;
      throw new Error(`Unsupported API operation: ${exhaustive}`);
    }
  }
}

/**
 * Unified server API entry for browser code.
 * - Static cPanel: remote `server-fn` on the Vercel backend (cross-origin).
 * - Vercel SSR: same-origin TanStack server functions.
 * - `http`: Firebase Cloud Functions (emulator / optional CF deploy only).
 */
export async function callServerApi<TData, TResult>(
  operation: ApiOperation,
  args: ServerFnCallArgs<TData>,
): Promise<TResult> {
  if (usesRemoteServerFn()) {
    return callRemoteServerFn(operation, args);
  }

  const transport = getApiTransport();
  if (transport === "server-fn") {
    return callLocalServerFn(operation, args);
  }

  return callHttpRestApi(operation, args);
}
