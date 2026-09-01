/** Allowed browser origins for Cloud Functions CORS (v2 `cors` option). */
export const CORS_ORIGINS = [
  "https://www.lunayairmarina.com",
  "https://lunayairmarina.com",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
];

export function readBearerToken(req: { headers: Record<string, unknown> }): string | null {
  const raw = req.headers.authorization ?? req.headers.Authorization;
  if (typeof raw !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1]?.trim() || null;
}

export function readJsonBody<T = unknown>(req: { body: unknown }): T {
  if (req.body === null || req.body === undefined) {
    throw new HttpError(400, "empty_body");
  }
  if (typeof req.body === "object") {
    return req.body as T;
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as T;
    } catch {
      throw new HttpError(400, "invalid_json");
    }
  }
  throw new HttpError(400, "invalid_body");
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function isFirebaseAuthError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: string }).code === "string" &&
      (error as { code: string }).code.startsWith("auth/"),
  );
}

export function mapErrorToHttp(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: error.message } };
  }
  if (isFirebaseAuthError(error)) {
    return { status: 401, body: { error: "UNAUTHORIZED" } };
  }
  const message = error instanceof Error ? error.message : "internal_error";
  if (message === "UNAUTHORIZED") {
    return { status: 401, body: { error: "UNAUTHORIZED" } };
  }
  if (message === "FORBIDDEN") {
    return { status: 403, body: { error: "FORBIDDEN" } };
  }
  if (message === "invalid_payload" || message.includes("required")) {
    return { status: 400, body: { error: message } };
  }
  console.error("[functions]", error);
  return { status: 500, body: { error: "internal_error" } };
}

export function requirePostMethod(method: string | undefined): void {
  if (method !== "POST") {
    throw new HttpError(405, "method_not_allowed");
  }
}

export async function requireAdminIdToken(req: {
  headers: Record<string, unknown>;
  body: unknown;
}): Promise<string> {
  const fromHeader = readBearerToken(req);
  if (fromHeader) return fromHeader;

  const body = readJsonBody<{ idToken?: string }>(req);
  const fromBody = body.idToken?.trim();
  if (fromBody) return fromBody;

  throw new HttpError(401, "UNAUTHORIZED");
}
