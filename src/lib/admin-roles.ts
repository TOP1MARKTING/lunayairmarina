export const ADMIN_PERMISSIONS = [
  "dashboard",
  "pages",
  "content",
  "services",
  "why",
  "trust",
  "blog",
  "gallery",
  "testimonials",
  "faq",
  "advertisements",
  "messages",
  "ai",
  "seo",
  "settings",
  "users",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export type AdminRoleId =
  | "super_admin"
  | "admin"
  | "customer_service"
  | "technical_support"
  | "assistant_admin"
  | "custom"
  | "it_manager";

/** Display order in the role picker (hierarchy roles first, then job titles). */
export const ADMIN_ROLE_IDS: AdminRoleId[] = [
  "super_admin",
  "admin",
  "customer_service",
  "technical_support",
  "assistant_admin",
  "custom",
  "it_manager",
];

/**
 * Account hierarchy. An actor may only create, edit or delete accounts on a
 * strictly lower level, and may never grant a permission they do not hold.
 */
export const ROLE_LEVEL: Record<AdminRoleId, number> = {
  super_admin: 3,
  admin: 2,
  customer_service: 1,
  technical_support: 1,
  assistant_admin: 1,
  custom: 1,
  it_manager: 1,
};

/**
 * Named presets that were retired in favour of picking permissions per staff member.
 * Existing accounts are migrated to `custom` while keeping the access they already had.
 */
const RETIRED_ROLE_PERMISSIONS: Record<string, AdminPermission[]> = {
  editor: [
    "dashboard",
    "pages",
    "content",
    "services",
    "why",
    "trust",
    "blog",
    "gallery",
    "testimonials",
    "faq",
    "advertisements",
    "seo",
  ],
  writer: ["dashboard", "blog", "gallery", "seo"],
  gallery_manager: ["dashboard", "gallery"],
  support: ["dashboard", "messages"],
};

/** Below this level an account can never manage other accounts. */
export const MANAGE_USERS_MIN_LEVEL = 2;

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminRoleId;
  permissions: AdminPermission[];
  active: boolean;
}

export const ROLE_PRESETS: Record<
  Exclude<AdminRoleId, "custom">,
  { permissions: AdminPermission[] }
> = {
  super_admin: { permissions: [...ADMIN_PERMISSIONS] },
  admin: { permissions: [...ADMIN_PERMISSIONS] },
  customer_service: {
    permissions: ["dashboard", "messages", "ai", "faq", "advertisements"],
  },
  technical_support: {
    permissions: ["dashboard", "messages", "ai"],
  },
  assistant_admin: {
    permissions: [
      "dashboard",
      "pages",
      "content",
      "services",
      "why",
      "trust",
      "blog",
      "gallery",
      "testimonials",
      "faq",
      "advertisements",
      "messages",
      "seo",
    ],
  },
  it_manager: {
    permissions: ["dashboard", "seo", "settings", "ai", "gallery", "messages"],
  },
};

export const DEFAULT_ADMIN_USERS: AdminUser[] = [
  {
    id: "u1",
    name: "lunayairmarina Admin",
    email: "admin@lunayairmarina.com",
    role: "super_admin",
    permissions: [...ADMIN_PERMISSIONS],
    active: true,
  },
];

export const USERS_STORAGE_KEY = "lunayairmarina.admin.users.v2";
export const SESSION_STORAGE_KEY = "lunayairmarina.admin.session";

export function permissionsForRole(role: AdminRoleId, custom?: AdminPermission[]) {
  if (role === "custom") return custom ?? [];
  return [...ROLE_PRESETS[role].permissions];
}

/**
 * Coerce any stored role onto the current set. Unknown / retired names collapse to `custom`.
 */
export function normalizeRole(role: unknown): AdminRoleId {
  if (typeof role === "string" && (ADMIN_ROLE_IDS as string[]).includes(role)) {
    return role as AdminRoleId;
  }
  return "custom";
}

/** Access a retired preset would have granted, used only when nothing was stored. */
export function migratedPermissionsFor(role: unknown): AdminPermission[] {
  return typeof role === "string" ? (RETIRED_ROLE_PERMISSIONS[role] ?? []) : [];
}

export function loadAdminUsers(): AdminUser[] {
  if (typeof window === "undefined") return DEFAULT_ADMIN_USERS;
  try {
    const raw = window.localStorage.getItem(USERS_STORAGE_KEY);
    if (!raw) return DEFAULT_ADMIN_USERS;
    const parsed = JSON.parse(raw) as AdminUser[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_ADMIN_USERS;
    // Drop removed permissions and retired role names; a stored permission set always
    // wins so per-user tuning is never silently widened back to a preset.
    return parsed.map((user) => {
      const role = normalizeRole(user.role);
      const stored = (user.permissions ?? []).filter((permission) =>
        ADMIN_PERMISSIONS.includes(permission),
      );
      const permissions =
        role === "super_admin"
          ? [...ADMIN_PERMISSIONS]
          : stored.length
            ? stored
            : migratedPermissionsFor(user.role);
      return { ...user, role, permissions };
    });
  } catch {
    return DEFAULT_ADMIN_USERS;
  }
}

export function saveAdminUsers(users: AdminUser[]) {
  window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
}

export const PERMISSION_ROUTE: Record<AdminPermission, string> = {
  dashboard: "/admin/dashboard",
  pages: "/admin/content",
  content: "/admin/content",
  services: "/admin/services",
  why: "/admin/why",
  trust: "/admin/trust",
  blog: "/admin/blog",
  gallery: "/admin/gallery",
  testimonials: "/admin/testimonials",
  faq: "/admin/faq",
  advertisements: "/admin/advertisements",
  messages: "/admin/messages",
  ai: "/admin/ai",
  seo: "/admin/seo",
  settings: "/admin/settings",
  users: "/admin/users",
};

export function isSuperAdmin(user: AdminUser | null | undefined) {
  return user?.role === "super_admin" && Boolean(user.active);
}

export function roleLevel(role: AdminRoleId) {
  return ROLE_LEVEL[role] ?? 1;
}

/** Effective level of an actor. Inactive accounts have no authority. */
export function userLevel(user: AdminUser | null | undefined) {
  if (!user?.active) return 0;
  return roleLevel(user.role);
}

/** An actor may delegate accounts only from Admin level up, and only with the `users` permission. */
export function canDelegateAccounts(actor: AdminUser | null | undefined) {
  if (!actor?.active) return false;
  if (isSuperAdmin(actor)) return true;
  return userLevel(actor) >= MANAGE_USERS_MIN_LEVEL && actor.permissions.includes("users");
}

export function canManageUser(actor: AdminUser | null | undefined, target: AdminUser) {
  if (!canDelegateAccounts(actor)) return false;
  if (actor!.id === target.id) return false;
  // Super Admin keeps full authority over every account, including peers.
  if (isSuperAdmin(actor)) return true;
  return userLevel(actor) > roleLevel(target.role);
}

/** Accounts an actor is allowed to see in the Users screen (own row included for context). */
export function visibleUsers(actor: AdminUser | null | undefined, users: AdminUser[]) {
  if (!canDelegateAccounts(actor)) return [];
  if (isSuperAdmin(actor)) return users;
  return users.filter((user) => user.id === actor!.id || roleLevel(user.role) < userLevel(actor));
}

/**
 * Roles an actor may hand out: strictly below their own level.
 * Super Admin is a single fixed account created at bootstrap, so it is never assignable.
 */
export function assignableRoles(actor: AdminUser | null | undefined): AdminRoleId[] {
  if (!canDelegateAccounts(actor)) return [];
  const maxLevel = userLevel(actor) - 1;
  return ADMIN_ROLE_IDS.filter((role) => roleLevel(role) <= maxLevel);
}

/**
 * Options for the role picker. Keeps a legacy account's current role listed so the
 * form still renders (and unchanged saves still pass) even if it is no longer assignable.
 */
export function selectableRoles(
  actor: AdminUser | null | undefined,
  currentRole?: AdminRoleId,
): AdminRoleId[] {
  const roles = assignableRoles(actor);
  if (currentRole && !roles.includes(currentRole)) return [currentRole, ...roles];
  return roles;
}

/** Permissions an actor may grant: never more than they hold themselves. */
export function grantablePermissions(
  actor: AdminUser | null | undefined,
  targetRole: AdminRoleId,
): AdminPermission[] {
  if (!canDelegateAccounts(actor)) return [];
  const owned = isSuperAdmin(actor) ? [...ADMIN_PERMISSIONS] : actor!.permissions;
  return ADMIN_PERMISSIONS.filter((permission) => {
    if (!owned.includes(permission)) return false;
    // Account management stays with Admin level and above.
    if (permission === "users" && roleLevel(targetRole) < MANAGE_USERS_MIN_LEVEL) return false;
    return true;
  });
}

/** Clamp a requested permission set to what the actor is actually allowed to grant. */
export function sanitizePermissions(
  actor: AdminUser | null | undefined,
  targetRole: AdminRoleId,
  requested: AdminPermission[],
): AdminPermission[] {
  const allowed = grantablePermissions(actor, targetRole);
  return allowed.filter((permission) => requested.includes(permission));
}

export function countActiveSuperAdmins(users: AdminUser[]) {
  return users.filter((user) => user.role === "super_admin" && user.active).length;
}

export function canDeleteUser(
  actor: AdminUser | null | undefined,
  target: AdminUser,
  users: AdminUser[],
) {
  if (!canManageUser(actor, target)) return false;
  if (target.role === "super_admin" && countActiveSuperAdmins(users) <= 1) return false;
  return true;
}

export function canChangeUserRole(
  actor: AdminUser | null | undefined,
  target: AdminUser,
  nextRole: AdminRoleId,
  users: AdminUser[],
) {
  if (!canManageUser(actor, target)) return false;
  // Keeping the existing role is always fine; switching to one requires the authority to grant it.
  if (nextRole !== target.role && !assignableRoles(actor).includes(nextRole)) return false;
  if (
    target.role === "super_admin" &&
    nextRole !== "super_admin" &&
    countActiveSuperAdmins(users) <= 1
  ) {
    return false;
  }
  return true;
}
