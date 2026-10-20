import { useMemo, useState } from "react";
import { createLazyFileRoute } from "@tanstack/react-router";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ModalField } from "@/components/admin/Modal";
import { useLanguage } from "@/lib/i18n";
import { changeOwnAdminPassword } from "@/services/adminUsersService";
import { loadCmsStore } from "@/lib/cms-store";
import {
  defaultSettingsFromMock,
  describeSaveResult,
  saveSettings,
} from "@/services/adminCmsService";

export const Route = createLazyFileRoute("/admin/settings")({
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  const { t } = useLanguage();
  const initial = useMemo(() => {
    const cms = loadCmsStore();
    return {
      settings: cms.settings ?? defaultSettingsFromMock(),
      logoUrl: cms.logoUrl ?? "",
    };
  }, []);

  const [settings, setSettings] = useState(initial.settings);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    // Keep existing brand logo — upload UI removed from settings.
    const result = await saveSettings(settings, initial.logoUrl || undefined);
    setStatus(
      describeSaveResult(result, {
        synced: t("admin.cms.savedSynced"),
        failed: t("admin.cms.savedFailed"),
      }),
    );
    setBusy(false);
  };

  const savePassword = async () => {
    if (newPassword.trim().length < 6) {
      setPasswordStatus(t("admin.users.passwordRequired"));
      return;
    }
    setPasswordBusy(true);
    setPasswordStatus(null);
    try {
      await changeOwnAdminPassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordStatus(t("admin.settings.passwordChanged"));
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      if (raw === "AUTH_REQUIRED") {
        setPasswordStatus(t("admin.users.authRequired"));
      } else if (raw === "WEAK_PASSWORD") {
        setPasswordStatus(t("admin.users.passwordRequired"));
      } else {
        setPasswordStatus(t("admin.settings.passwordChangeFailed"));
      }
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <AdminLayout title={t("admin.settings.title")}>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-navy/8 bg-white p-6 shadow-sm">
          <h2 className="font-display text-lg text-navy">{t("admin.settings.general")}</h2>
          <div className="mt-6 flex flex-col gap-5">
            <ModalField
              label={t("admin.settings.companyName")}
              value={settings.companyName}
              onChange={(value) => setSettings({ ...settings, companyName: value })}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <ModalField
                label={t("admin.settings.phone")}
                value={settings.phoneDisplay}
                onChange={(value) =>
                  setSettings({
                    ...settings,
                    phoneDisplay: value,
                    phone: value.replace(/\s/g, ""),
                  })
                }
              />
              <ModalField
                label="WhatsApp"
                value={settings.whatsapp}
                onChange={(value) => setSettings({ ...settings, whatsapp: value })}
              />
            </div>
            <ModalField
              label={t("admin.settings.email")}
              value={settings.email}
              onChange={(value) => setSettings({ ...settings, email: value })}
            />
            <ModalField
              textarea
              label={`${t("admin.settings.address")} (EN)`}
              value={settings.address.en}
              onChange={(value) =>
                setSettings({
                  ...settings,
                  address: { ...settings.address, en: value },
                })
              }
            />
            <ModalField
              textarea
              label={`${t("admin.settings.address")} (AR)`}
              value={settings.address.ar}
              onChange={(value) =>
                setSettings({
                  ...settings,
                  address: { ...settings.address, ar: value },
                })
              }
            />
          </div>
        </section>

        <section className="rounded-2xl border border-navy/8 bg-white p-6 shadow-sm">
          <h2 className="font-display text-lg text-navy">{t("admin.settings.social")}</h2>
          <div className="mt-6 flex flex-col gap-5">
            <ModalField
              label="Instagram"
              value={settings.socialLinks.instagram}
              onChange={(value) =>
                setSettings({
                  ...settings,
                  socialLinks: { ...settings.socialLinks, instagram: value },
                })
              }
            />
            <ModalField
              label="LinkedIn"
              value={settings.socialLinks.linkedin}
              onChange={(value) =>
                setSettings({
                  ...settings,
                  socialLinks: { ...settings.socialLinks, linkedin: value },
                })
              }
            />
            <ModalField
              label="TikTok"
              value={settings.socialLinks.tiktok ?? ""}
              onChange={(value) =>
                setSettings({
                  ...settings,
                  socialLinks: { ...settings.socialLinks, tiktok: value },
                })
              }
            />
            <ModalField
              label="X"
              value={settings.socialLinks.x ?? ""}
              onChange={(value) =>
                setSettings({
                  ...settings,
                  socialLinks: { ...settings.socialLinks, x: value },
                })
              }
            />
          </div>
        </section>

        <section className="rounded-2xl border border-navy/8 bg-white p-6 shadow-sm">
          <h2 className="font-display text-lg text-navy">{t("admin.settings.changePassword")}</h2>
          <p className="mt-2 text-xs text-muted-foreground">{t("admin.settings.changePasswordHint")}</p>
          <div className="mt-6 flex flex-col gap-5">
            <ModalField
              label={t("admin.settings.currentPassword")}
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
            />
            <ModalField
              label={t("admin.settings.newPassword")}
              type="password"
              value={newPassword}
              onChange={setNewPassword}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={passwordBusy}
                onClick={() => void savePassword()}
                className="rounded-full bg-navy px-5 py-2.5 text-xs tracking-[0.18em] text-white uppercase disabled:opacity-60"
              >
                {t("admin.settings.updatePassword")}
              </button>
              {passwordStatus ? (
                <span className="text-xs text-navy/60">{passwordStatus}</span>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      <div className="mt-8 flex items-center gap-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-full bg-navy px-6 py-3 text-xs tracking-[0.18em] text-white uppercase transition-colors hover:bg-navy/90 disabled:opacity-60"
        >
          {t("admin.content.save")}
        </button>
        {status ? <span className="text-xs text-navy/60">{status}</span> : null}
      </div>
    </AdminLayout>
  );
}
