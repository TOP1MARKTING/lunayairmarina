import { getFirebaseAuth } from "@/lib/firebase";

/** Attach Firebase ID token for admin Cloud Function calls (HTTP transport). */
export async function getAdminAuthorizationHeaders(): Promise<HeadersInit> {
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new Error("AUTH_REQUIRED");
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function mergeAdminAuthHeaders(extra?: HeadersInit): Promise<HeadersInit> {
  const adminHeaders = await getAdminAuthorizationHeaders();
  const merged = new Headers(extra);
  const auth = new Headers(adminHeaders);
  auth.forEach((value, key) => {
    if (!merged.has(key)) merged.set(key, value);
  });
  return merged;
}
