import { getFirebaseAuth } from "@/lib/firebase";

/** Firebase ID token for the signed-in admin. */
export async function getAdminIdToken(): Promise<string> {
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new Error("AUTH_REQUIRED");
  }
  return token;
}

/** Attach Firebase ID token for admin Cloud Function calls (HTTP transport). */
export async function getAdminAuthorizationHeaders(): Promise<HeadersInit> {
  return {
    Authorization: `Bearer ${await getAdminIdToken()}`,
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
