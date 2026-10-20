import { createLazyFileRoute } from "@tanstack/react-router";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { PageCopyEditor } from "@/components/admin/PageCopyEditor";
import { useLanguage } from "@/lib/i18n";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Shield } from "lucide-react";

export const Route = createLazyFileRoute("/admin/content")({
  component: ContentPage,
});

function ContentPage() {
  const { t } = useLanguage();
  const { can } = useAdminAuth();

  if (!can("content") && !can("pages")) {
    return (
      <AdminLayout title={t("admin.nav.content")}>
        <div className="rounded-2xl border border-navy/8 bg-white p-10 text-center shadow-sm">
          <Shield className="mx-auto size-8 text-gold" strokeWidth={1.4} />
          <p className="mt-4 text-navy">{t("admin.users.noAccess")}</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title={t("admin.content.title")}>
      <p className="mb-6 max-w-2xl text-sm text-navy/55">{t("admin.content.subtitle")}</p>
      <PageCopyEditor />
    </AdminLayout>
  );
}
