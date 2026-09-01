import type { Request } from "firebase-functions/v2/https";
import { verifyActiveAdmin, verifySuperAdmin } from "./auth";
import { HttpError } from "./cors";

function isFirebaseAuthError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: string }).code === "string" &&
      (error as { code: string }).code.startsWith("auth/"),
  );
}

/** Map auth failures to HTTP-safe errors without leaking Firebase internals. */
export function mapAuthFailure(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return new HttpError(403, "FORBIDDEN");
  }
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return new HttpError(401, "UNAUTHORIZED");
  }
  if (isFirebaseAuthError(error)) {
    return new HttpError(401, "UNAUTHORIZED");
  }
  console.error("[functions][auth]", error);
  return new HttpError(401, "UNAUTHORIZED");
}

/** Parse Bearer token or legacy JSON body `idToken`. Never returns empty tokens. */
export function parseAuthorization(req: Request): string {
  const raw = req.headers.authorization ?? req.headers.Authorization;

  if (typeof raw === "string" && raw.trim()) {
    const trimmed = raw.trim();
    if (!/^Bearer\s+/i.test(trimmed)) {
      throw new HttpError(401, "UNAUTHORIZED");
    }
    const token = trimmed.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      throw new HttpError(401, "UNAUTHORIZED");
    }
    return token;
  }

  const body =
    typeof req.body === "object" && req.body !== null
      ? (req.body as { idToken?: string })
      : {};
  const fromBody = body.idToken?.trim();
  if (fromBody) return fromBody;

  throw new HttpError(401, "UNAUTHORIZED");
}

export async function requireActiveAdminRequest(req: Request): Promise<string> {
  const token = parseAuthorization(req);
  try {
    return await verifyActiveAdmin(token);
  } catch (error) {
    throw mapAuthFailure(error);
  }
}

export async function requireSuperAdminRequest(req: Request): Promise<string> {
  const token = parseAuthorization(req);
  try {
    return await verifySuperAdmin(token);
  } catch (error) {
    throw mapAuthFailure(error);
  }
}
