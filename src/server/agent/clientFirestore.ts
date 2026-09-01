/**
 * Server-only Firestore via the public Web SDK when Admin SDK is unavailable.
 * Never import @/lib/firebase here — that module uses import.meta.env and browser APIs.
 */
import { initializeApp, getApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { resolveFirebaseWebConfig } from "@/lib/firebaseConfig";

let app: FirebaseApp | undefined;
let db: Firestore | undefined;

function readProcessEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Fallback Firestore for server runtimes without Admin credentials (e.g. legacy SSR). */
export function getClientFirestoreFallback(): Firestore {
  if (!db) {
    try {
      app = getApp();
    } catch {
      app = initializeApp(resolveFirebaseWebConfig(readProcessEnv));
    }
    db = getFirestore(app);
  }
  return db;
}
