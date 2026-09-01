import { onRequest } from "firebase-functions/v2/https";
import { getAdminFirestore, getFirebaseAdminApp } from "../../src/server/agent/firebaseAdmin";
import { requireSuperAdminRequest } from "./shared/adminAuth";
import { CORS_ORIGINS, HttpError } from "./shared/cors";
import { handlePostJson } from "./shared/http";

const CREDENTIALS_DOC = "credentials";
const PRIVATE_COLLECTION = "private";

export const adminSetUserPassword = onRequest(
  {
    cors: CORS_ORIGINS,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  handlePostJson(async (body, req) => {
    const payload = body as { idToken?: string; uid?: string; password?: string };
    const password = payload.password?.trim() ?? "";
    const uid = payload.uid?.trim() ?? "";
    if (!uid || password.length < 6) {
      throw new HttpError(400, "invalid_payload");
    }

    await requireSuperAdminRequest(req);

    try {
      const { getAuth } = await import("firebase-admin/auth");
      const auth = getAuth(await getFirebaseAdminApp());
      await auth.updateUser(uid, { password });
      const db = await getAdminFirestore();
      await db
        .collection("admins")
        .doc(uid)
        .collection(PRIVATE_COLLECTION)
        .doc(CREDENTIALS_DOC)
        .set({
          password,
          updatedAt: new Date().toISOString(),
        });
      return { ok: true as const };
    } catch (error) {
      console.error("[adminSetUserPassword]", error);
      return {
        ok: false as const,
        error: "password_update_failed",
      };
    }
  }),
);
