import { getAdminFirestore, getFirebaseAdminApp } from "@/server/agent/firebaseAdmin";

/** Verify Firebase ID token and ensure the caller is an active admin. */
export async function requireActiveAdminFromToken(idToken: string): Promise<string> {
  const { getAuth } = await import("firebase-admin/auth");
  const auth = getAuth(await getFirebaseAdminApp());
  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch {
    throw new Error("UNAUTHORIZED");
  }
  const db = await getAdminFirestore();
  const snap = await db.collection("admins").doc(decoded.uid).get();
  if (!snap.exists) throw new Error("FORBIDDEN");
  const data = snap.data();
  if (data?.active === false) throw new Error("FORBIDDEN");
  return decoded.uid;
}
