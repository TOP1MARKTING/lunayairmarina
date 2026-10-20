import { Link } from "@tanstack/react-router";
import { Bell, ExternalLink, Menu } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";
import { useAdminAuth } from "@/hooks/useAdminAuth";

interface AdminHeaderProps {
  title: string;
  onMenu: () => void;
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "LM";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function AdminHeader({ title, onMenu }: AdminHeaderProps) {
  const { t } = useLanguage();
  const { user } = useAdminAuth();
  const initials = getInitials(user?.name || t("brand.name"));

  return (
    <header className="admin-header-surface sticky top-0 z-30 border-b pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-5 sm:py-4 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onMenu}
            aria-label="Open menu"
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-navy/10 bg-white text-navy shadow-sm transition hover:border-gold/40 hover:bg-gold/10 lg:hidden"
          >
            <Menu className="size-5" strokeWidth={1.5} />
          </button>
          <div className="min-w-0">
            <p className="hidden text-[0.58rem] tracking-[0.2em] text-navy/35 uppercase sm:block">
              {t("brand.name")}
            </p>
            <h1 className="truncate font-display text-lg leading-tight text-navy sm:mt-0.5 sm:text-2xl">
              {title}
            </h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
          <div className="scale-90 sm:scale-100">
            <LanguageSwitcher />
          </div>
          <Link
            to="/admin/messages"
            aria-label={t("admin.dashboard.actions.reviewInbox")}
            className="grid size-10 place-items-center rounded-full border border-navy/10 bg-white text-navy/60 shadow-sm transition hover:border-gold/45 hover:bg-gold/10 hover:text-navy"
          >
            <Bell className="size-4" strokeWidth={1.5} />
          </Link>
          <Link
            to="/"
            aria-label={t("admin.backToSite")}
            className="grid size-10 place-items-center rounded-full border border-navy/10 bg-white text-navy/60 shadow-sm transition hover:border-gold/45 hover:bg-gold/10 hover:text-navy sm:hidden"
          >
            <ExternalLink className="size-4" strokeWidth={1.5} />
          </Link>
          <Link
            to="/"
            className="hidden items-center gap-2 rounded-full border border-navy/10 bg-white px-3.5 py-2 text-xs text-navy/65 shadow-sm transition hover:border-gold/45 hover:bg-gold/10 hover:text-navy sm:inline-flex"
          >
            <ExternalLink className="size-3.5" strokeWidth={1.5} />
            {t("admin.backToSite")}
          </Link>
          <span
            title={user?.name ?? t("brand.name")}
            className="grid size-10 place-items-center rounded-full border border-gold/50 bg-gradient-to-br from-navy to-ocean text-[0.65rem] tracking-wide text-white shadow-[0_0_0_3px_color-mix(in_oklab,var(--gold)_16%,transparent)]"
          >
            {initials}
          </span>
        </div>
      </div>
    </header>
  );
}
