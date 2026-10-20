/**
 * Server-only Firebase Admin SDK bootstrap for knowledge ingestion.
 * Bypasses Firestore Security Rules (service account privilege).
 * Never import this module from client/browser code.
 *
 * Uses dynamic imports so Nitro/Vercel does not bundle firebase-admin into
 * server-fn chunks (bundled admin SDK crashes with SDK_VERSION errors).
 *
 * Credentials (first match wins):
 * 1. FIREBASE_SERVICE_ACCOUNT_JSON — full service-account JSON string (Vercel / local)
 * 2. FIREBASE_SERVICE_ACCOUNT_PATH / GOOGLE_APPLICATION_CREDENTIALS — local file path
 * 3. Application Default Credentials — Cloud Functions / Cloud Run runtime
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildEnvDiagnostics,
  parseJsonEnvValue,
  safeErrorMessage,
  type SafeAdminDiagnostics,
} from "./firebaseAdminDiagnostics";

type ServiceAccountJson = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

type AdminApp = import("firebase-admin/app").App;
type AdminFirestore = import("firebase-admin/firestore").Firestore;

type AdminModules = {
  cert: typeof import("firebase-admin/app").cert;
  getApps: typeof import("firebase-admin/app").getApps;
  initializeApp: typeof import("firebase-admin/app").initializeApp;
  getFirestore: typeof import("firebase-admin/firestore").getFirestore;
};

let adminModulesPromise: Promise<AdminModules> | undefined;
let adminApp: AdminApp | undefined;
let adminDb: AdminFirestore | undefined;

async function loadAdminModules(): Promise<AdminModules> {
  if (!adminModulesPromise) {
    adminModulesPromise = Promise.all([
      import("firebase-admin/app"),
      import("firebase-admin/firestore"),
    ]).then(([appMod, firestoreMod]) => ({
      cert: appMod.cert,
      getApps: appMod.getApps,
      initializeApp: appMod.initializeApp,
      getFirestore: firestoreMod.getFirestore,
    }));
  }
  return adminModulesPromise;
}

function resolveProjectId(serviceAccount?: ServiceAccountJson): string {
  const fromEnv =
    process.env.FIREBASE_PROJECT_ID?.trim() || process.env.VITE_FIREBASE_PROJECT_ID?.trim();
  if (fromEnv) return fromEnv;
  if (serviceAccount?.project_id?.trim()) return serviceAccount.project_id.trim();
  return "lunayairmarina-2d694";
}

function normalizePrivateKey(key: string): string {
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

function parseServiceAccountObject(parsed: unknown, source: string): ServiceAccountJson {
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`[firebase-admin] ${source} must contain a JSON object.`);
  }
  const account = parsed as ServiceAccountJson;
  if (!account.client_email || !account.private_key) {
    throw new Error(
      `[firebase-admin] ${source} is missing required fields (client_email / private_key).`,
    );
  }
  return {
    ...account,
    private_key: normalizePrivateKey(account.private_key),
  };
}

function loadServiceAccountFromJsonEnv(): ServiceAccountJson | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    return parseServiceAccountObject(
      parseJsonEnvValue(raw),
      "FIREBASE_SERVICE_ACCOUNT_JSON",
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("[firebase-admin]")) throw error;
    throw new Error(
      "[firebase-admin] FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the full service account JSON as one line/string.",
    );
  }
}

function resolveServiceAccountPath(): string | null {
  const path =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  return path ? resolve(path) : null;
}

function loadServiceAccountFromFile(path: string): ServiceAccountJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      "[firebase-admin] Could not read or parse the service account JSON file. " +
        "Check FIREBASE_SERVICE_ACCOUNT_PATH points to a valid JSON file.",
    );
  }
  return parseServiceAccountObject(parsed, "service account file");
}

function isGoogleCloudRuntime(): boolean {
  return Boolean(
    process.env.FUNCTION_TARGET?.trim() ||
      process.env.K_SERVICE?.trim() ||
      process.env.CLOUD_RUN_SERVICE?.trim() ||
      process.env.FIREBASE_CONFIG?.trim(),
  );
}

function loadServiceAccount(): ServiceAccountJson | null {
  const fromJson = loadServiceAccountFromJsonEnv();
  if (fromJson) return fromJson;

  const path = resolveServiceAccountPath();
  if (path) return loadServiceAccountFromFile(path);

  return null;
}

export async function getFirebaseAdminApp(): Promise<AdminApp> {
  if (adminApp) return adminApp;
  const { cert, getApps, initializeApp } = await loadAdminModules();
  const existing = getApps()[0];
  if (existing) {
    adminApp = existing;
    return adminApp;
  }

  const serviceAccount = loadServiceAccount();
  if (serviceAccount) {
    const projectId = resolveProjectId(serviceAccount);
    adminApp = initializeApp({
      credential: cert(serviceAccount as Parameters<typeof cert>[0]),
      projectId,
    });
    return adminApp;
  }

  if (isGoogleCloudRuntime()) {
    adminApp = initializeApp({ projectId: resolveProjectId() });
    return adminApp;
  }

  throw new Error(
    "[firebase-admin] Missing credentials. Set FIREBASE_SERVICE_ACCOUNT_JSON, " +
      "FIREBASE_SERVICE_ACCOUNT_PATH / GOOGLE_APPLICATION_CREDENTIALS, " +
      "or run on Cloud Functions with Application Default Credentials.",
  );
}

export async function getAdminFirestore(): Promise<AdminFirestore> {
  if (!adminDb) {
    const { getFirestore } = await loadAdminModules();
    adminDb = getFirestore(await getFirebaseAdminApp());
  }
  return adminDb;
}

/** True when Admin credentials are configured (does not validate the key). */
export function hasFirebaseAdminCredentials(): boolean {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ||
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      isGoogleCloudRuntime(),
  );
}

/** Safe runtime probe — no secrets logged. */
export async function probeAdminFirestore(): Promise<SafeAdminDiagnostics> {
  const base = buildEnvDiagnostics();
  if (!hasFirebaseAdminCredentials()) {
    return {
      ...base,
      ADMIN_INIT: false,
      ADMIN_DB: false,
      ADMIN_INIT_ERROR_MESSAGE: "missing credentials env",
    };
  }
  try {
    const db = await getAdminFirestore();
    const projectId = (await getFirebaseAdminApp()).options.projectId ?? base.ADMIN_PROJECT_ID;
    return {
      ...base,
      ADMIN_PROJECT_ID: projectId ?? base.ADMIN_PROJECT_ID,
      ADMIN_INIT: true,
      ADMIN_DB: Boolean(db),
      ADMIN_INIT_ERROR_MESSAGE: null,
    };
  } catch (error) {
    return {
      ...base,
      ADMIN_INIT: false,
      ADMIN_DB: false,
      ADMIN_INIT_ERROR_MESSAGE: safeErrorMessage(error),
    };
  }
}

/** Soft init — returns null when credentials are missing or invalid (no secrets logged). */
export async function tryGetAdminFirestore(): Promise<AdminFirestore | null> {
  if (!hasFirebaseAdminCredentials()) return null;
  try {
    return await getAdminFirestore();
  } catch (error) {
    console.error("[firebase-admin] init failed:", {
      ...buildEnvDiagnostics(),
      ADMIN_INIT: false,
      ADMIN_DB: false,
      ADMIN_INIT_ERROR_MESSAGE: safeErrorMessage(error),
    });
    return null;
  }
}

/** Confirms Admin SDK can initialize without logging secrets. */
export async function assertFirebaseAdminReady(): Promise<{
  projectId: string;
  credentialSource: string;
}> {
  const app = await getFirebaseAdminApp();
  const projectId = app.options.projectId ?? resolveProjectId();
  const source = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
    ? "FIREBASE_SERVICE_ACCOUNT_JSON"
    : process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim()
      ? "FIREBASE_SERVICE_ACCOUNT_PATH"
      : process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
        ? "GOOGLE_APPLICATION_CREDENTIALS"
        : isGoogleCloudRuntime()
          ? "APPLICATION_DEFAULT_CREDENTIALS"
          : "unknown";
  return { projectId, credentialSource: source };
}
