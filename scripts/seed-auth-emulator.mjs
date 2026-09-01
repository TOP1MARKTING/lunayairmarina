/**
 * Seed Auth + Firestore emulators with temporary authorization test users.
 * Emulator-only — never run against production.
 */
import { existsSync } from "node:fs";
import { resolve, isAbsolute, dirname } from "node:path";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(root, ".env") });

process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

const usingFirestoreEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST?.trim());
if (!usingFirestoreEmulator) {
  delete process.env.FIRESTORE_EMULATOR_HOST;
}

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID?.trim() || "lunayairmarina-2d694";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PASSWORD = "CfAuthTest!2026";

export const AUTH_TEST_USERS = {
  normal: {
    uid: "cf-test-normal-user",
    email: "cf-test-normal@emulator.local",
  },
  activeAdmin: {
    uid: "cf-test-active-admin",
    email: "cf-test-admin@emulator.local",
  },
  superAdmin: {
    uid: "cf-test-super-admin",
    email: "cf-test-super@emulator.local",
  },
};

function absolutizeCredentialPath(name) {
  const raw = process.env[name]?.trim();
  if (!raw) return false;
  const abs = isAbsolute(raw) ? raw : resolve(root, raw);
  if (!existsSync(abs)) return false;
  process.env[name] = abs;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = abs;
  return true;
}

absolutizeCredentialPath("FIREBASE_SERVICE_ACCOUNT_PATH");

async function signInWithPassword(email, password) {
  const url = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const json = await response.json();
  if (!response.ok || !json.idToken) {
    throw new Error(`signIn failed for ${email}`);
  }
  return json.idToken;
}

async function main() {
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");

  if (!getApps().length) {
    initializeApp({ projectId: PROJECT_ID });
  }

  const auth = getAuth();
  const db = getFirestore();

  const users = [
    AUTH_TEST_USERS.normal,
    AUTH_TEST_USERS.activeAdmin,
    AUTH_TEST_USERS.superAdmin,
  ];

  for (const user of users) {
    try {
      await auth.createUser({
        uid: user.uid,
        email: user.email,
        password: PASSWORD,
        emailVerified: true,
      });
      console.log(`[seed-auth-emulator] created ${user.email}`);
    } catch (error) {
      const code = error && typeof error === "object" ? error.code : "";
      if (code === "auth/uid-already-exists" || code === "auth/email-already-exists") {
        await auth.updateUser(user.uid, {
          email: user.email,
          password: PASSWORD,
          emailVerified: true,
        });
        console.log(`[seed-auth-emulator] updated ${user.email}`);
      } else {
        throw error;
      }
    }
  }

  await db.collection("admins").doc(AUTH_TEST_USERS.activeAdmin.uid).set({
    active: true,
    role: "admin",
    email: AUTH_TEST_USERS.activeAdmin.email,
  });
  await db.collection("admins").doc(AUTH_TEST_USERS.superAdmin.uid).set({
    active: true,
    role: "super_admin",
    email: AUTH_TEST_USERS.superAdmin.email,
  });

  const tokens = {
    normal: await signInWithPassword(AUTH_TEST_USERS.normal.email, PASSWORD),
    activeAdmin: await signInWithPassword(AUTH_TEST_USERS.activeAdmin.email, PASSWORD),
    superAdmin: await signInWithPassword(AUTH_TEST_USERS.superAdmin.email, PASSWORD),
  };

  console.log("[seed-auth-emulator] admin docs seeded");
  console.log(
    "[seed-auth-emulator] firestore target:",
    usingFirestoreEmulator ? "emulator" : "project (admin docs only)",
  );
  console.log("[seed-auth-emulator] tokens ready (not printed)");
  return tokens;
}

if (process.argv[1]?.includes("seed-auth-emulator")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export default main;
