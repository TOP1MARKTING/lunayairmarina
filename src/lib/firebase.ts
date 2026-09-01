import { initializeApp, getApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getAuth, type Auth } from "firebase/auth";
import {
  hasCompleteFirebaseWebEnv,
  resolveFirebaseWebConfig,
  type FirebaseWebConfig,
} from "./firebaseConfig";

/**
 * Firebase Web SDK config is public by design (security is Firestore/Auth rules).
 * Prefer VITE_* env on Vercel/local; fall back so SSR does not 500 when env is unset.
 */
function readViteEnv(name: string): string | undefined {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  if (typeof value === "string" && value.trim()) return value.trim();
  const fromProcess = process.env[name];
  if (typeof fromProcess === "string" && fromProcess.trim()) return fromProcess.trim();
  return undefined;
}

function resolveFirebaseConfig(): FirebaseWebConfig {
  if (!hasCompleteFirebaseWebEnv(readViteEnv) && import.meta.env.PROD) {
    console.warn(
      "[firebase] VITE_FIREBASE_* env incomplete — using public web config fallback. Set env vars in Vercel for clarity.",
    );
  }
  return resolveFirebaseWebConfig(readViteEnv);
}

let resolvedConfig: FirebaseWebConfig | undefined;
let app: FirebaseApp | undefined;
let db: Firestore | undefined;
let storage: FirebaseStorage | undefined;
let auth: Auth | undefined;
let secondaryApp: FirebaseApp | undefined;
let secondaryAuth: Auth | undefined;

export function getFirebaseConfig(): FirebaseWebConfig {
  if (!resolvedConfig) resolvedConfig = resolveFirebaseConfig();
  return resolvedConfig;
}

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    // Always bind to the default app — never grab getApps()[0], which can be the
    // Secondary invite app and would make create-user signOut wipe the admin session.
    try {
      app = getApp();
    } catch {
      app = initializeApp(getFirebaseConfig());
    }
  }
  return app;
}

export function getDb(): Firestore {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

export function getFirebaseStorage(): FirebaseStorage {
  if (!storage) storage = getStorage(getFirebaseApp());
  return storage;
}

export function getFirebaseAuth(): Auth {
  if (!auth) auth = getAuth(getFirebaseApp());
  return auth;
}

/** Secondary Auth app — create users without signing out the current Super Admin. */
export function getSecondaryAuth(): Auth {
  if (!secondaryApp) {
    try {
      secondaryApp = getApp("Secondary");
    } catch {
      secondaryApp = initializeApp(getFirebaseConfig(), "Secondary");
    }
  }
  if (!secondaryAuth) secondaryAuth = getAuth(secondaryApp);
  return secondaryAuth;
}

/** Firestore bound to the Secondary app (uses Secondary Auth token). */
export function getSecondaryDb(): Firestore {
  getSecondaryAuth();
  return getFirestore(getApp("Secondary"));
}

/** Lazy-resolved config object for any legacy callers. */
export const firebaseConfig = new Proxy({} as FirebaseWebConfig, {
  get(_target, prop) {
    return Reflect.get(getFirebaseConfig(), prop);
  },
});

export type { FirebaseWebConfig } from "./firebaseConfig";
