import { Link, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  Anchor,
  Award,
  Bot,
  ClipboardList,
  Globe2,
  HelpCircle,
  Images,
  Inbox,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Newspaper,
  Quote,
  Settings2,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import type { AdminPermission } from "@/lib/admin-roles";
import { Logo } from "@/components/shared/Logo";

type NavIcon = typeof LayoutDashboard;

type NavItem = {
  to: string;
  key: string;
  icon: NavIcon;
  permission: AdminPermission;
};

type NavGroup = {
  id: "overview" | "content" | "growth" | "system";
  labelKey: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    id: "overview",
    labelKey: "admin.nav.groups.overview",
    items: [
      {
        to: "/admin/dashboard",
        key: "admin.nav.dashboard",
        icon: LayoutDashboard,
        permission: "dashboard",
      },
    ],
  },
  {
    id: "content",
    labelKey: "admin.nav.groups.content",
    items: [
      { to: "/admin/content", key: "admin.nav.content", icon: ClipboardList, permission: "content" },
      { to: "/admin/services", key: "admin.nav.services", icon: Anchor, permission: "services" },
      { to: "/admin/why", key: "admin.nav.why", icon: Award, permission: "why" },
      { to: "/admin/trust", key: "admin.nav.trust", icon: ShieldCheck, permission: "trust" },
      { to: "/admin/blog", key: "admin.nav.blog", icon: Newspaper, permission: "blog" },
      { to: "/admin/gallery", key: "admin.nav.gallery", icon: Images, permission: "gallery" },
      {
        to: "/admin/testimonials",
        key: "admin.nav.testimonials",
        icon: Quote,
        permission: "testimonials",
      },
      { to: "/admin/faq", key: "admin.nav.faq", icon: HelpCircle, permission: "faq" },
    ],
  },
  {
    id: "growth",
    labelKey: "admin.nav.groups.growth",
    items: [
      {
        to: "/admin/advertisements",
        key: "admin.nav.advertisements",
        icon: Megaphone,
        permission: "advertisements",
      },
      { to: "/admin/messages", key: "admin.nav.messages", icon: Inbox, permission: "messages" },
      { to: "/admin/ai", key: "admin.nav.ai", icon: Bot, permission: "ai" },
    ],
  },
  {
    id: "system",
    labelKey: "admin.nav.groups.system",
    items: [
      { to: "/admin/seo", key: "admin.nav.seo", icon: Globe2, permission: "seo" },
      { to: "/admin/users", key: "admin.nav.users", icon: UsersRound, permission: "users" },
      { to: "/admin/settings", key: "admin.nav.settings", icon: Settings2, permission: "settings" },
    ],
  },
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "LM";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLanguage();
  const { logout, can, user } = useAdminAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const groups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.permission === "content") return can("content") || can("pages");
        return can(item.permission);
      }),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="admin-sidebar-surface flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col items-center border-b border-white/10 px-4 pb-5 pt-14 sm:px-5 sm:pt-6 lg:pt-7">
        <div className="rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-black/5">
          <Logo tone="dark" align="center" className="h-14 w-36 sm:h-[4.5rem] sm:w-44" />
        </div>
        <p className="mt-3 text-[0.62rem] tracking-[0.22em] text-white/45 uppercase">
          {t("admin.nav.controlCenter")}
        </p>
        <span
          className="mt-3 h-px w-14 bg-gradient-to-r from-transparent via-gold to-transparent"
          aria-hidden
        />
      </div>

      <nav className="admin-hide-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-3.5">
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.id}>
              <p className="admin-nav-label mb-2 px-3 text-[0.58rem] tracking-[0.2em] uppercase">
                {t(group.labelKey)}
              </p>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const active =
                    pathname === item.to ||
                    (item.to === "/admin/content" && pathname.startsWith("/admin/pages"));
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={onNavigate}
                        className={cn(
                          "group relative flex min-h-11 items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-all duration-300",
                          active ? "admin-nav-active font-medium" : "",
                        )}
                      >
                        {active ? (
                          <span
                            className="absolute inset-y-2 start-0 w-1 rounded-full bg-navy"
                            aria-hidden
                          />
                        ) : null}
                        <span
                          className={cn(
                            "admin-nav-icon grid size-9 shrink-0 place-items-center rounded-xl transition-colors",
                            active ? "" : "admin-nav-icon-idle",
                          )}
                        >
                          <Icon className="size-4" strokeWidth={1.55} />
                        </span>
                        <span className="truncate">{t(item.key)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="shrink-0 border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {user ? (
          <div className="mb-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/8 px-3 py-2.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-full border border-gold/50 bg-gold/20 text-[0.65rem] tracking-wide text-gold">
              {initials(user.name)}
            </span>
            <span className="min-w-0">
              <p className="truncate text-xs font-medium text-white">{user.name}</p>
              <p className="truncate text-[0.65rem] text-white/45" dir="ltr">
                {user.email}
              </p>
            </span>
          </div>
        ) : null}
        <button
          type="button"
          onClick={logout}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/55 transition-colors hover:bg-red-500/15 hover:text-red-300"
        >
          <LogOut className="size-4 shrink-0 rtl:rotate-180" strokeWidth={1.5} />
          {t("admin.nav.logout")}
        </button>
      </div>
    </div>
  );
}

export function AdminSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isRTL } = useLanguage();
  const slideFrom = isRTL ? "100%" : "-100%";

  return (
    <>
      <aside className="admin-hide-scrollbar fixed inset-y-0 start-0 z-40 hidden w-72 overflow-hidden border-e border-navy/10 shadow-[8px_0_32px_-24px_rgba(7,26,43,0.35)] lg:block">
        <SidebarBody />
      </aside>

      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-50 bg-navy/45 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: slideFrom }}
              animate={{ x: 0 }}
              exit={{ x: slideFrom }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="admin-hide-scrollbar fixed inset-y-0 start-0 z-50 w-[min(19rem,calc(100vw-2.5rem))] overflow-hidden shadow-luxe lg:hidden"
            >
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute top-[max(0.75rem,env(safe-area-inset-top))] end-3 z-10 grid size-11 place-items-center rounded-xl border border-white/15 bg-white/10 text-white/70 transition-colors hover:border-gold/40 hover:bg-gold/15 hover:text-gold"
              >
                <X className="size-5" strokeWidth={1.5} />
              </button>
              <SidebarBody onNavigate={onClose} />
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
