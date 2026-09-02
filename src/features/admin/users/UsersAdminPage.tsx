import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { DataTable, RowAction, StatusBadge, type Column } from "@/components/admin/DataTable";
import { Modal, ModalField } from "@/components/admin/Modal";
import { useLanguage } from "@/lib/i18n";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import {
  assignableRoles,
  canChangeUserRole,
  canDelegateAccounts,
  canDeleteUser,
  canManageUser,
  grantablePermissions,
  loadAdminUsers,
  permissionsForRole,
  sanitizePermissions,
  saveAdminUsers,
  selectableRoles,
  visibleUsers,
  type AdminPermission,
  type AdminRoleId,
  type AdminUser,
} from "@/lib/admin-roles";
import {
  createAdminUser,
  deleteAdminUserProfile,
  fetchAdminPasswords,
  fetchAdminUsersFromFirebase,
  sendAdminPasswordReset,
  updateAdminUser,
} from "@/services/adminUsersService";
import { cn } from "@/lib/utils";

type Draft = {
  name: string;
  email: string;
  password: string;
  role: AdminRoleId;
  permissions: AdminPermission[];
  active: boolean;
};

const emptyDraft: Draft = {
  name: "",
  email: "",
  password: "",
  role: "custom",
  permissions: [],
  active: true,
};

export function UsersAdminPage() {
  const { t } = useLanguage();
  const { user: currentUser, can, isSuperAdmin: viewerIsSuperAdmin } = useAdminAuth();
  const [rows, setRows] = useState<AdminUser[]>(() => loadAdminUsers());
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshPasswords = useCallback(async (userRows: AdminUser[]) => {
    if (!viewerIsSuperAdmin) {
      setPasswords({});
      return;
    }
    const ids = visibleUsers(currentUser, userRows).map((row) => row.id);
    if (!ids.length) {
      setPasswords({});
      return;
    }
    try {
      setPasswords(await fetchAdminPasswords(ids));
    } catch {
      setPasswords({});
    }
  }, [viewerIsSuperAdmin, currentUser]);

  useEffect(() => {
    void fetchAdminUsersFromFirebase()
      .then((users) => {
        if (users.length) {
          setRows(users);
          saveAdminUsers(users);
          void refreshPasswords(users);
        }
      })
      .catch(() => {
        // Keep local cache if Firebase is unreachable.
      });
  }, [refreshPasswords]);

  useEffect(() => {
    void refreshPasswords(rows);
  }, [refreshPasswords, rows]);

  if (!can("users") || !canDelegateAccounts(currentUser)) {
    return (
      <AdminLayout title={t("admin.nav.users")}>
        <div className="rounded-2xl border border-navy/8 bg-white p-10 text-center shadow-sm">
          <Shield className="mx-auto size-8 text-gold" strokeWidth={1.4} />
          <p className="mt-4 text-navy">{t("admin.users.noAccess")}</p>
        </div>
      </AdminLayout>
    );
  }

  const editingTarget = editingId ? (rows.find((row) => row.id === editingId) ?? null) : null;
  const roleOptions = selectableRoles(currentUser, editingTarget?.role);
  const allowedPermissions = grantablePermissions(currentUser, draft.role);
  const listedRows = visibleUsers(currentUser, rows);

  // New accounts start as staff with nothing ticked; the creator picks each permission.
  const initialDraft = (): Draft => ({ ...emptyDraft, role: "custom", permissions: [] });

  const persistLocal = (next: AdminUser[]) => {
    setRows(next);
    saveAdminUsers(next);
    window.dispatchEvent(new Event("lunayairmarina-admin-users"));
  };

  /** Picking a role sets the level and seeds its preset; checkboxes then fine-tune it. */
  const setRole = (role: AdminRoleId) => {
    setDraft((current) => {
      const seed = role === "custom" ? current.permissions : permissionsForRole(role);
      return { ...current, role, permissions: sanitizePermissions(currentUser, role, seed) };
    });
  };

  const togglePermission = (permission: AdminPermission) => {
    setDraft((current) => {
      const linked: AdminPermission[] =
        permission === "content" ? ["content", "pages"] : [permission];
      const exists = linked.every((item) => current.permissions.includes(item));
      const permissions = exists
        ? current.permissions.filter((item) => !linked.includes(item))
        : Array.from(new Set([...current.permissions, ...linked]));
      return {
        ...current,
        permissions: sanitizePermissions(currentUser, current.role, permissions),
      };
    });
  };

  const save = async () => {
    if (!draft.name.trim() || !draft.email.trim()) return;
    const target = editingId != null ? rows.find((row) => row.id === editingId) : null;

    if (target && !canManageUser(currentUser, target)) {
      setNotice(t("admin.users.noAccess"));
      return;
    }
    if (target && !canChangeUserRole(currentUser, target, draft.role, rows)) {
      setNotice(
        target.id === currentUser?.id
          ? t("admin.users.cannotEditSelfRole")
          : t("admin.users.protectLastSuper"),
      );
      return;
    }
    if (draft.role !== target?.role && !assignableRoles(currentUser).includes(draft.role)) {
      setNotice(t("admin.users.roleNotAllowed"));
      return;
    }
    if (
      target?.role === "super_admin" &&
      (!draft.active || draft.role !== "super_admin") &&
      rows.filter((item) => item.role === "super_admin" && item.active).length <= 1
    ) {
      setNotice(t("admin.users.protectLastSuper"));
      return;
    }

    if (!editingId && draft.password.trim().length < 6) {
      setNotice(t("admin.users.passwordRequired"));
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      if (editingId) {
        const updated = await updateAdminUser(editingId, {
          name: draft.name.trim(),
          email: draft.email.trim().toLowerCase(),
          role: draft.role,
          permissions: sanitizePermissions(currentUser, draft.role, draft.permissions),
          active: draft.active,
          password: draft.password.trim() || undefined,
        });
        persistLocal(rows.map((row) => (row.id === editingId ? updated : row)));
        if (draft.password.trim()) {
          if (viewerIsSuperAdmin) {
            setPasswords((prev) => ({ ...prev, [editingId]: draft.password.trim() }));
            setNotice(t("admin.users.passwordUpdated"));
            void refreshPasswords(
              rows.map((row) => (row.id === editingId ? updated : row)),
            );
          } else {
            setNotice(t("admin.users.resetSent"));
          }
        }
      } else {
        const created = await createAdminUser({
          name: draft.name.trim(),
          email: draft.email.trim().toLowerCase(),
          password: draft.password.trim(),
          role: draft.role,
          permissions: sanitizePermissions(currentUser, draft.role, draft.permissions),
          active: draft.active,
        });
        const withoutDup = rows.filter(
          (row) => row.id !== created.id && row.email !== created.email,
        );
        const nextRows = [...withoutDup, created];
        persistLocal(nextRows);
        if (viewerIsSuperAdmin) {
          setPasswords((prev) => ({ ...prev, [created.id]: draft.password.trim() }));
          void refreshPasswords(nextRows);
        }
        setNotice(t("admin.users.saved"));
      }
      setOpen(false);
      setEditingId(null);
      setDraft(initialDraft());
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code ?? "")
          : "";
      if (raw === "EMAIL_EXISTS_WRONG_PASSWORD") {
        setNotice(t("admin.users.emailInUse"));
      } else if (raw === "AUTH_REQUIRED" || raw === "SUPER_ADMIN_REQUIRED") {
        setNotice(t("admin.users.authRequired"));
      } else if (raw === "FORBIDDEN_HIERARCHY") {
        setNotice(t("admin.users.hierarchyDenied"));
      } else if (code.includes("email-already-in-use")) {
        setNotice(t("admin.users.emailInUse"));
      } else if (code.includes("permission-denied") || raw.includes("permission")) {
        setNotice(t("admin.users.permissionDenied"));
      } else {
        setNotice(raw || t("admin.users.saveFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<AdminUser>[] = [
    {
      key: "name",
      header: t("admin.table.name"),
      render: (row) => (
        <div>
          <p className="font-medium text-navy">{row.name}</p>
          <p className="text-xs text-muted-foreground" dir="ltr">
            {row.email}
          </p>
        </div>
      ),
    },
    {
      key: "role",
      header: t("admin.users.role"),
      render: (row) => <span className="text-navy">{t(`admin.users.roles.${row.role}`)}</span>,
    },
    ...(viewerIsSuperAdmin
      ? [
          {
            key: "password",
            header: t("admin.users.passwordColumn"),
            render: (row: AdminUser) => (
              <span className="font-mono text-xs text-navy/80" dir="ltr">
                {passwords[row.id] || t("admin.users.passwordUnknown")}
              </span>
            ),
          } satisfies Column<AdminUser>,
        ]
      : []),
    {
      key: "permissions",
      header: t("admin.users.permissions"),
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.permissions.length} {t("admin.users.permissionsCount")}
        </span>
      ),
    },
    {
      key: "status",
      header: t("admin.table.status"),
      render: (row) => (
        <StatusBadge
          label={row.active ? t("admin.status.active") : t("admin.users.inactive")}
          tone={row.active ? "active" : "draft"}
        />
      ),
    },
  ];

  return (
    <AdminLayout title={t("admin.nav.users")}>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm text-muted-foreground">{t("admin.users.subtitle")}</p>
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setDraft(initialDraft());
            setNotice(null);
            setOpen(true);
          }}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-navy px-5 py-3 text-xs tracking-[0.18em] text-white uppercase transition-colors hover:bg-navy/90 sm:w-auto"
        >
          <Plus className="size-4" strokeWidth={1.5} />
          {t("admin.users.add")}
        </button>
      </div>

      {notice ? (
        <p className="mb-4 rounded-xl border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {notice}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        rows={listedRows}
        getRowId={(row) => row.id}
        actions={(row) => {
          if (!canManageUser(currentUser, row)) {
            return <span className="text-xs text-muted-foreground">—</span>;
          }
          return (
            <>
              <RowAction
                icon={Pencil}
                label={t("admin.actions.edit")}
                onClick={() => {
                  setEditingId(row.id);
                  setDraft({
                    name: row.name,
                    email: row.email,
                    password: "",
                    role: row.role,
                    permissions: [...row.permissions],
                    active: row.active,
                  });
                  setNotice(null);
                  setOpen(true);
                }}
              />
              <RowAction
                icon={KeyRound}
                label={t("admin.users.resetPassword")}
                onClick={() => {
                  void sendAdminPasswordReset(row.email)
                    .then(() => setNotice(t("admin.users.resetSent")))
                    .catch(() => setNotice(t("admin.users.saveFailed")));
                }}
              />
              <RowAction
                icon={Trash2}
                tone="danger"
                confirm={false}
                label={t("admin.actions.delete")}
                onClick={() => {
                  if (!canDeleteUser(currentUser, row, rows)) {
                    setNotice(t("admin.users.protectLastSuper"));
                    return;
                  }
                  if (!window.confirm(t("admin.actions.confirmDelete"))) return;
                  void deleteAdminUserProfile(row.id)
                    .then(() => persistLocal(rows.filter((item) => item.id !== row.id)))
                    .catch(() => setNotice(t("admin.users.saveFailed")));
                }}
              />
            </>
          );
        }}
      />

      <Modal
        open={open}
        title={editingId ? t("admin.users.edit") : t("admin.users.add")}
        onClose={() => setOpen(false)}
        onSubmit={() => void save()}
        busy={busy}
      >
        <ModalField
          label={t("admin.table.name")}
          value={draft.name}
          onChange={(value) => setDraft({ ...draft, name: value })}
        />
        <ModalField
          label={t("admin.table.email")}
          type="email"
          value={draft.email}
          onChange={(value) => setDraft({ ...draft, email: value })}
        />
        <ModalField
          label={editingId ? t("admin.users.newPasswordOptional") : t("admin.password")}
          type="password"
          value={draft.password}
          onChange={(value) => setDraft({ ...draft, password: value })}
        />
        {editingId && viewerIsSuperAdmin ? (
          <p className="text-xs text-muted-foreground">{t("admin.users.editPasswordHintSuperAdmin")}</p>
        ) : editingId ? (
          <p className="text-xs text-muted-foreground">{t("admin.users.editPasswordHint")}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{t("admin.users.passwordHint")}</p>
        )}

        <label className="flex flex-col gap-2">
          <span className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
            {t("admin.users.role")}
          </span>
          <select
            value={draft.role}
            onChange={(event) => setRole(event.target.value as AdminRoleId)}
            className="rounded-md border border-navy/10 bg-[#faf8f4] px-4 py-3 text-sm outline-none transition-colors focus:border-navy/30"
          >
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {t(`admin.users.roles.${role}`)}
              </option>
            ))}
          </select>
        </label>

        <div>
          <p className="text-[0.6rem] tracking-[0.22em] text-muted-foreground uppercase">
            {t("admin.users.permissions")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t("admin.users.permissionsHint")}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {allowedPermissions
              .filter((permission) => permission !== "pages")
              .map((permission) => {
                const checked =
                  permission === "content"
                    ? draft.permissions.includes("content") || draft.permissions.includes("pages")
                    : draft.permissions.includes(permission);
                return (
                  <label
                    key={permission}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-3 text-sm transition-colors",
                      checked ? "border-gold/50 bg-gold/8 text-navy" : "border-border text-navy/70",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePermission(permission)}
                      className="accent-[oklch(0.755_0.075_82)]"
                    />
                    {t(`admin.users.permissionLabels.${permission}`)}
                  </label>
                );
              })}
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm text-navy">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
            className="accent-[oklch(0.755_0.075_82)]"
          />
          {t("admin.users.activeAccount")}
        </label>
      </Modal>
    </AdminLayout>
  );
}
