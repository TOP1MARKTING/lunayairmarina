/** Shared Firebase Web SDK config — safe for server and client (no import.meta / window). */

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

export const PUBLIC_WEB_FALLBACK: FirebaseWebConfig = {
  apiKey: "AIzaSyA6rTHWzaQJVPxI9hyViPIv3g0R6d7f6O8",
  authDomain: "lunayairmarina-2d694.firebaseapp.com",
  projectId: "lunayairmarina-2d694",
  storageBucket: "lunayairmarina-2d694.firebasestorage.app",
  messagingSenderId: "640687266007",
  appId: "1:640687266007:web:3effccbfa5897130277892",
  measurementId: "G-VB6Y6RRZFL",
};

export type EnvReader = (name: string) => string | undefined;

export function resolveFirebaseWebConfig(readEnv: EnvReader): FirebaseWebConfig {
  const fromEnv = {
    apiKey: readEnv("VITE_FIREBASE_API_KEY"),
    authDomain: readEnv("VITE_FIREBASE_AUTH_DOMAIN"),
    projectId: readEnv("VITE_FIREBASE_PROJECT_ID"),
    storageBucket: readEnv("VITE_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: readEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    appId: readEnv("VITE_FIREBASE_APP_ID"),
    measurementId: readEnv("VITE_FIREBASE_MEASUREMENT_ID"),
  };

  const requiredOk =
    fromEnv.apiKey &&
    fromEnv.authDomain &&
    fromEnv.projectId &&
    fromEnv.storageBucket &&
    fromEnv.messagingSenderId &&
    fromEnv.appId;

  if (requiredOk) {
    return {
      apiKey: fromEnv.apiKey!,
      authDomain: fromEnv.authDomain!,
      projectId: fromEnv.projectId!,
      storageBucket: fromEnv.storageBucket!,
      messagingSenderId: fromEnv.messagingSenderId!,
      appId: fromEnv.appId!,
      measurementId: fromEnv.measurementId,
    };
  }

  return { ...PUBLIC_WEB_FALLBACK };
}

export function hasCompleteFirebaseWebEnv(readEnv: EnvReader): boolean {
  return Boolean(
    readEnv("VITE_FIREBASE_API_KEY") &&
      readEnv("VITE_FIREBASE_AUTH_DOMAIN") &&
      readEnv("VITE_FIREBASE_PROJECT_ID") &&
      readEnv("VITE_FIREBASE_STORAGE_BUCKET") &&
      readEnv("VITE_FIREBASE_MESSAGING_SENDER_ID") &&
      readEnv("VITE_FIREBASE_APP_ID"),
  );
}
