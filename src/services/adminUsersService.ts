import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
  type User,
} from "firebase/auth";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, type Firestore } from "firebase/firestore";
import { getDb, getFirebaseAuth, getSecondaryAuth, getSecondaryDb } from "@/lib/firebase";
import {
  ADMIN_PERMISSIONS,
  assignableRoles,
  canDelegateAccounts,
  canManageUser,
  DEFAULT_ADMIN_USERS,
  grantablePermissions,
  isSuperAdmin,
  migratedPermissionsFor,
  normalizeRole,
  saveAdminUsers,
  type AdminPermission,
  type AdminRoleId,
  type AdminUser,
} from "@/lib/admin-roles";
import { setAdminUserPassword } from "@/lib/api/adminUsers";

const ADMINS_COLLECTION = "admins";
const PRIVATE_COLLECTION = "private";
const CREDENTIALS_DOC = "credentials";

/** Raised when the signed-in actor tries to reach above or across their own level. */
const FORBIDDEN = "FORBIDDEN_HIERARCHY";

function authCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: string }).code ?? "");
  }
  return "";
}

async function markBootstrap(uid: string, email: string, db = getDb()) {
  const ref = doc(db, "config", "bootstrap");
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, {
    uid,
    email,
    createdAt: new Date().toISOString(),
  });
}

async function isBootstrapLocked(db = getDb()): Promise<boolean> {
  const snap = await getDoc(doc(db, "config", "bootstrap"));
  return snap.exists();
}

export type AdminUserInput = {
  name: string;
  email: string;
  password?: string;
  role: AdminRoleId;
  permissions: AdminPermission[];
  active: boolean;
};

function normalizeUser(id: string, data: Record<string, unknown>): AdminUser | null {
  if (typeof data.email !== "string" || typeof data.name !== "string") return null;
  const role = normalizeRole(data.role);
  const rawPermissions = Array.isArray(data.permissions)
    ? (data.permissions as AdminPermission[])
    : [];
  const stored = rawPermissions.filter((permission) => ADMIN_PERMISSIONS.includes(permission));
  // Stored permissions win so per-user tuning survives; retired presets only seed empty sets.
  const permissions =
    role === "super_admin"
      ? [...ADMIN_PERMISSIONS]
      : stored.length
        ? stored
        : migratedPermissionsFor(data.role);

  return {
    id,
    name: data.name,
    email: data.email.toLowerCase(),
    role,
    permissions,
    active: data.active !== false,
  };
}

function buildProfile(uid: string, input: AdminUserInput, email: string): AdminUser {
  return {
    id: uid,
    name: input.name.trim(),
    email,
    role: input.role,
    permissions: input.role === "super_admin" ? [...ADMIN_PERMISSIONS] : [...input.permissions],
    active: input.active,
  };
}

function credentialsRef(uid: string, db: Firestore = getDb()) {
  return doc(db, ADMINS_COLLECTION, uid, PRIVATE_COLLECTION, CREDENTIALS_DOC);
}

export async function storeAdminPassword(
  uid: string,
  password: string,
  db: Firestore = getDb(),
): Promise<void> {
  await setDoc(credentialsRef(uid, db), {
    password,
    updatedAt: new Date().toISOString(),
  });
}

export async function getAdminPassword(uid: string): Promise<string | null> {
  const snap = await getDoc(credentialsRef(uid));
  if (!snap.exists()) return null;
  const value = snap.data()?.password;
  return typeof value === "string" && value.length ? value : null;
}

export async function fetchAdminPasswords(uids: string[]): Promise<Record<string, string>> {
  const entries = await Promise.all(
    uids.map(async (uid) => {
      const password = await getAdminPassword(uid);
      return password ? ([uid, password] as const) : null;
    }),
  );
  return Object.fromEntries(entries.filter(Boolean) as Array<[string, string]>);
}

export async function changeOwnAdminPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  const user = auth.currentUser;
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) throw new Error("AUTH_REQUIRED");
  if (newPassword.trim().length < 6) throw new Error("WEAK_PASSWORD");

  const credential = EmailAuthProvider.credential(email, currentPassword.trim());
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword.trim());
  await storeAdminPassword(user.uid, newPassword.trim());
}

async function setPasswordAsSuperAdmin(uid: string, password: string): Promise<void> {
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("AUTH_REQUIRED");
  const result = await setAdminUserPassword({ data: { idToken, uid, password } });
  if (!result.ok) throw new Error(result.error || "PASSWORD_UPDATE_FAILED");
}

/** Resolve the signed-in actor's stored profile and confirm they may delegate at all. */
async function requireDelegatingActor(): Promise<AdminUser> {
  const auth = getFirebaseAuth();
  // Wait for IndexedDB restore — currentUser can be null for a beat even while logged in.
  await auth.authStateReady();
  const current = auth.currentUser;
  if (!current) throw new Error("AUTH_REQUIRED");
  const actor = await getAdminProfile(current.uid);
  if (!actor || !canDelegateAccounts(actor)) throw new Error(FORBIDDEN);
  return actor;
}

/** An actor may never hand out a role at or above their level, nor a permission they lack. */
function assertCanAssign(
  actor: AdminUser,
  role: AdminRoleId,
  permissions: AdminPermission[],
  currentRole?: AdminRoleId,
) {
  if (role !== currentRole && !assignableRoles(actor).includes(role)) throw new Error(FORBIDDEN);
  const allowed = grantablePermissions(actor, role);
  if (permissions.some((permission) => !allowed.includes(permission))) {
    throw new Error(FORBIDDEN);
  }
}

async function writeAdminProfile(profile: AdminUser) {
  // Always write with the signed-in Super Admin token (primary app).
  await setDoc(
    doc(getDb(), ADMINS_COLLECTION, profile.id),
    {
      ...profile,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
  if (profile.role === "super_admin") {
    await markBootstrap(profile.id, profile.email);
  }
}

export async function fetchAdminUsersFromFirebase(): Promise<AdminUser[]> {
  const snap = await getDocs(collection(getDb(), ADMINS_COLLECTION));
  const users = snap.docs
    .map((item) => normalizeUser(item.id, item.data() as Record<string, unknown>))
    .filter((item): item is AdminUser => Boolean(item));
  if (users.length) {
    saveAdminUsers(users);
    return users;
  }
  return [];
}

export async function getAdminProfile(uid: string): Promise<AdminUser | null> {
  const snap = await getDoc(doc(getDb(), ADMINS_COLLECTION, uid));
  if (!snap.exists()) return null;
  return normalizeUser(snap.id, snap.data() as Record<string, unknown>);
}

/**
 * Invite a user one level below the signed-in actor:
 * 1) Create (or reclaim) Firebase Auth account with email+password
 * 2) Save role/permissions profile in Firestore admins/{uid}
 */
export async function createAdminUser(input: AdminUserInput): Promise<AdminUser> {
  const email = input.email.trim().toLowerCase();
  const password = input.password?.trim() ?? "";
  if (!email || !input.name.trim()) {
    throw new Error("Name and email are required.");
  }
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const actor = await requireDelegatingActor();
  assertCanAssign(actor, input.role, input.permissions);

  const primary = getFirebaseAuth();
  const primaryUid = primary.currentUser?.uid;
  if (!primaryUid) throw new Error("AUTH_REQUIRED");

  const secondary = getSecondaryAuth();
  let uid = "";

  try {
    try {
      const credential = await createUserWithEmailAndPassword(secondary, email, password);
      uid = credential.user.uid;
      try {
        await updateProfile(credential.user, { displayName: input.name.trim() });
      } catch {
        // Optional.
      }
    } catch (createError) {
      const code = authCode(createError);
      if (!code.includes("email-already-in-use")) throw createError;

      // Auth account already exists — sign in with the password just entered to attach/update profile.
      try {
        const existing = await signInWithEmailAndPassword(secondary, email, password);
        uid = existing.user.uid;
      } catch {
        throw new Error("EMAIL_EXISTS_WRONG_PASSWORD");
      }
    }

    // Creating on Secondary must never replace the primary admin session.
    if (primary.currentUser?.uid !== primaryUid) {
      throw new Error("AUTH_REQUIRED");
    }

    const profile = buildProfile(uid, input, email);
    await writeAdminProfile(profile);
    await storeAdminPassword(uid, password);
    return profile;
  } finally {
    try {
      await signOut(secondary);
    } catch {
      // ignore
    }
  }
}

/**
 * Load admin profile after Auth sign-in.
 * Creates Super Admin only once (first bootstrap). Later Auth users need an invite from Super Admin.
 */
export async function ensureAdminProfileFromAuth(user: User): Promise<AdminUser | null> {
  const existing = await getAdminProfile(user.uid);
  if (existing) {
    if (!existing.active) return null;
    if (existing.role === "super_admin") {
      try {
        await markBootstrap(user.uid, existing.email);
      } catch {
        // Ignore marker failures; profile is enough to enter.
      }
    }
    return existing;
  }

  if (await isBootstrapLocked()) return null;

  const email = (user.email ?? "").trim().toLowerCase();
  if (!email) return null;

  const profile: AdminUser = {
    id: user.uid,
    name: user.displayName?.trim() || email.split("@")[0] || "Admin",
    email,
    role: "super_admin",
    permissions: [...ADMIN_PERMISSIONS],
    active: true,
  };

  await setDoc(doc(getDb(), ADMINS_COLLECTION, user.uid), {
    ...profile,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await markBootstrap(user.uid, email);
  return profile;
}

export async function updateAdminUser(
  id: string,
  input: Omit<AdminUserInput, "password"> & { password?: string },
): Promise<AdminUser> {
  const actor = await requireDelegatingActor();
  const target = await getAdminProfile(id);
  if (!target || !canManageUser(actor, target)) throw new Error(FORBIDDEN);
  assertCanAssign(actor, input.role, input.permissions, target.role);

  const profile = buildProfile(
    id,
    { ...input, password: undefined },
    input.email.trim().toLowerCase(),
  );

  await updateDoc(doc(getDb(), ADMINS_COLLECTION, id), {
    name: profile.name,
    email: profile.email,
    role: profile.role,
    permissions: profile.permissions,
    active: profile.active,
    updatedAt: new Date().toISOString(),
  });

  if (input.password?.trim()) {
    const nextPassword = input.password.trim();
    if (isSuperAdmin(actor)) {
      await setPasswordAsSuperAdmin(id, nextPassword);
      await storeAdminPassword(id, nextPassword);
    } else {
      await sendPasswordResetEmail(getFirebaseAuth(), profile.email);
    }
  }

  return profile;
}

export async function deleteAdminUserProfile(id: string) {
  const actor = await requireDelegatingActor();
  const target = await getAdminProfile(id);
  if (!target || !canManageUser(actor, target)) throw new Error(FORBIDDEN);
  await deleteDoc(doc(getDb(), ADMINS_COLLECTION, id));
}

export async function sendAdminPasswordReset(email: string) {
  await sendPasswordResetEmail(getFirebaseAuth(), email.trim().toLowerCase());
}

/**
 * If Auth user does not exist yet and bootstrap is unlocked, create the first Super Admin.
 */
export async function bootstrapSuperAdminIfNeeded(
  email: string,
  password: string,
  name = "lunayairmarina Admin",
): Promise<AdminUser | null> {
  try {
    if (await isBootstrapLocked()) return null;
  } catch {
    // Continue if rules/network blocked the read.
  }

  const normalized = email.trim().toLowerCase();
  const pass = password.trim();
  const secondary = getSecondaryAuth();

  try {
    let uid = "";
    try {
      const credential = await createUserWithEmailAndPassword(secondary, normalized, pass);
      uid = credential.user.uid;
      try {
        await updateProfile(credential.user, { displayName: name });
      } catch {
        // Optional.
      }
    } catch (createError) {
      const code = authCode(createError);
      if (code.includes("email-already-in-use")) return null;
      throw createError;
    }

    const profile = buildProfile(
      uid,
      {
        name,
        email: normalized,
        password: pass,
        role: "super_admin",
        permissions: [...ADMIN_PERMISSIONS],
        active: true,
      },
      normalized,
    );

    // First bootstrap: secondary token can create own super_admin profile (rules allow).
    await setDoc(doc(getSecondaryDb(), ADMINS_COLLECTION, profile.id), {
      ...profile,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await markBootstrap(profile.id, profile.email, getSecondaryDb());
    await storeAdminPassword(profile.id, pass, getSecondaryDb());
    return profile;
  } catch (error) {
    const code = authCode(error);
    if (code.includes("email-already-in-use")) return null;
    throw error;
  } finally {
    try {
      await signOut(secondary);
    } catch {
      // ignore
    }
  }
}

export function mergeUsersCache(users: AdminUser[]) {
  saveAdminUsers(users.length ? users : DEFAULT_ADMIN_USERS);
}
