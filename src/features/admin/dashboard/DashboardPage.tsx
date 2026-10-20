import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  Anchor,
  ArrowRight,
  ArrowUpRight,
  Bot,
  ClipboardList,
  HelpCircle,
  Images,
  Inbox,
  Newspaper,
  Quote,
  Settings2,
  Ship,
  Sparkles,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { DashboardCard } from "@/components/admin/DashboardCard";
import { StatusBadge } from "@/components/admin/DataTable";
import { AdminSectionTitle } from "@/components/admin/AdminUi";
import { useLanguage } from "@/lib/i18n";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useOptionalSiteContent } from "@/providers/SiteContentProvider";
import {
  faqRecords,
  galleryImages,
  messageRecords,
  serviceRecords,
  testimonialRecords,
  type MessageRecord,
} from "@/data/mock";
import { loadBlogPosts } from "@/data/blog";
import { SERVICE_SLUGS } from "@/data/services";
import { CMS_UPDATED_EVENT, loadCmsStore, type FirebaseSyncStatus } from "@/lib/cms-store";
import { cn } from "@/lib/utils";

interface LeadRecord {
  name?: string;
  email?: string;
  phone?: string;
  yachtType?: string;
  serviceNeeded?: string;
  message?: string;
  createdAt?: string;
}

function greetingKey(hour: number) {
  if (hour < 12) return "admin.dashboard.greeting.morning";
  if (hour < 18) return "admin.dashboard.greeting.afternoon";
  return "admin.dashboard.greeting.evening";
}

export function DashboardPage() {
  const { t, language, isRTL } = useLanguage();
  const { user } = useAdminAuth();
  const site = useOptionalSiteContent();
  const CtaArrow = isRTL ? ArrowRight : ArrowUpRight;

  const [postsCount, setPostsCount] = useState(0);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [recentInbox, setRecentInbox] = useState<MessageRecord[]>(() => messageRecords.slice(0, 5));
  const [inboxCount, setInboxCount] = useState(messageRecords.length);
  const [newMessageCount, setNewMessageCount] = useState(
    messageRecords.filter((item) => item.status === "new").length,
  );
  const [syncStatus, setSyncStatus] = useState<FirebaseSyncStatus>("unknown");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const refreshLocal = () => {
      setPostsCount(loadBlogPosts().length);
      const cms = loadCmsStore();
      setSyncStatus(cms.firebaseSync);
      if (cms.messages.length) {
        const mapped: MessageRecord[] = cms.messages.map((item) => ({
          id: item.id,
          name: item.name,
          email: item.email,
          phone: item.phone,
          message: item.message,
          date: item.date,
          status: item.status,
        }));
        setInboxCount(mapped.length);
        setNewMessageCount(mapped.filter((item) => item.status === "new").length);
        setRecentInbox(mapped.slice(0, 5));
        setLeads(
          cms.messages
            .filter((item) => item.source === "contact-form")
            .slice(0, 8)
            .map((item) => ({
              name: item.name,
              email: item.email,
              phone: item.phone,
              yachtType: item.yachtType,
              serviceNeeded: item.serviceNeeded,
              message: item.message,
              createdAt: item.date,
            })),
        );
        return;
      }
      setRecentInbox(messageRecords.slice(0, 5));
      setInboxCount(messageRecords.length);
      setNewMessageCount(messageRecords.filter((item) => item.status === "new").length);
      try {
        const raw = window.localStorage.getItem("lunayairmarina-leads");
        const parsed = raw ? (JSON.parse(raw) as LeadRecord[]) : [];
        setLeads(Array.isArray(parsed) ? parsed.slice(0, 8) : []);
      } catch {
        setLeads([]);
      }
    };
    refreshLocal();
    window.addEventListener(CMS_UPDATED_EVENT, refreshLocal);
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => {
      window.removeEventListener(CMS_UPDATED_EVENT, refreshLocal);
      window.clearInterval(timer);
    };
  }, []);

  const galleryCount = site?.bundle?.gallery?.length || galleryImages.length;
  const servicesCount =
    site?.bundle?.services?.length || SERVICE_SLUGS.length || serviceRecords.length;
  const testimonialsCount = site?.bundle?.testimonials?.length || testimonialRecords.length;
  const faqCount = site?.bundle?.faq?.length || faqRecords.length;
  const newMessages = { length: newMessageCount };
  const syncLabel =
    syncStatus === "synced"
      ? t("admin.cms.syncSynced")
      : syncStatus === "error"
        ? t("admin.cms.syncError")
        : syncStatus === "local"
          ? t("admin.cms.syncLocal")
          : t("admin.cms.syncUnknown");

  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(now),
    [language, now],
  );

  const quickActions = [
    {
      to: "/admin/content",
      icon: ClipboardList,
      title: t("admin.dashboard.actions.content"),
      body: t("admin.dashboard.actions.contentHint"),
    },
    {
      to: "/admin/ai",
      icon: Bot,
      title: t("admin.nav.ai"),
      body: t("admin.dashboard.actions.aiHint"),
    },
    {
      to: "/admin/messages",
      icon: Inbox,
      title: t("admin.dashboard.actions.messages"),
      body: t("admin.dashboard.actions.messagesHint"),
    },
    {
      to: "/admin/settings",
      icon: Settings2,
      title: t("admin.dashboard.actions.settings"),
      body: t("admin.dashboard.actions.settingsHint"),
    },
  ] as const;

  const contentHealth = [
    { label: t("admin.nav.services"), value: servicesCount, to: "/admin/services", icon: Anchor },
    { label: t("admin.nav.blog"), value: postsCount, to: "/admin/blog", icon: Newspaper },
    { label: t("admin.nav.gallery"), value: galleryCount, to: "/admin/gallery", icon: Images },
    {
      label: t("admin.nav.testimonials"),
      value: testimonialsCount,
      to: "/admin/testimonials",
      icon: Quote,
    },
    { label: t("admin.nav.faq"), value: faqCount, to: "/admin/faq", icon: HelpCircle },
    {
      label: t("admin.dashboard.stats.messages"),
      value: inboxCount,
      to: "/admin/messages",
      icon: Inbox,
    },
  ];

  return (
    <AdminLayout title={t("admin.dashboard.title")}>
      <section className="admin-panel-dark relative overflow-hidden px-4 py-6 sm:px-8 sm:py-9">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent"
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full border border-gold/35 bg-gold/15 px-3 py-1 text-[0.65rem] tracking-[0.18em] text-gold uppercase">
              <Sparkles className="size-3.5 shrink-0" strokeWidth={1.6} />
              {t(greetingKey(now.getHours()))}
            </p>
            <h2 className="mt-4 break-words font-display text-3xl leading-tight text-white sm:text-4xl lg:text-5xl">
              {user?.name || t("brand.name")}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/65 sm:text-base">
              {t("admin.dashboard.welcomeLead")}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-white/55">
              <span className="rounded-full border border-white/15 bg-white/8 px-3 py-1.5">
                {dateLabel}
              </span>
              <span
                className={cn(
                  "rounded-full border px-3 py-1.5",
                  syncStatus === "synced"
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                    : syncStatus === "error"
                      ? "border-red-400/30 bg-red-400/10 text-red-200"
                      : "border-white/15 bg-white/8 text-white/55",
                )}
              >
                {syncLabel}
              </span>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:gap-3">
            <Link
              to="/"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-gold/55 bg-gold px-5 py-2.5 text-[0.7rem] tracking-[0.18em] text-navy uppercase shadow-[0_12px_28px_-14px_rgba(200,169,106,0.8)] transition hover:bg-gold-soft"
            >
              {t("admin.backToSite")}
              <CtaArrow className="size-3.5 rtl:rotate-180" strokeWidth={1.6} />
            </Link>
            <Link
              to="/admin/messages"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/8 px-5 py-2.5 text-[0.7rem] tracking-[0.18em] text-white uppercase transition hover:border-gold/45 hover:bg-gold/15 hover:text-gold"
            >
              {t("admin.dashboard.actions.reviewInbox")}
              {newMessages.length > 0 ? (
                <span className="rounded-full bg-gold px-2 py-0.5 text-[0.65rem] text-navy">
                  {newMessages.length}
                </span>
              ) : null}
            </Link>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-3 sm:mt-8 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-6">
        <DashboardCard
          icon={Newspaper}
          label={t("admin.dashboard.stats.posts")}
          value={postsCount}
          hint={t("admin.dashboard.stats.postsHint")}
          to="/admin/blog"
          index={0}
        />
        <DashboardCard
          icon={Anchor}
          label={t("admin.dashboard.stats.services")}
          value={servicesCount}
          hint={t("admin.dashboard.stats.servicesHint")}
          to="/admin/services"
          index={1}
        />
        <DashboardCard
          icon={Images}
          label={t("admin.dashboard.stats.images")}
          value={galleryCount}
          hint={t("admin.dashboard.stats.imagesHint")}
          to="/admin/gallery"
          index={2}
        />
        <DashboardCard
          icon={Inbox}
          label={t("admin.dashboard.stats.messages")}
          value={inboxCount}
          trend={
            newMessages.length > 0
              ? t("admin.dashboard.stats.newMessages").replace(
                  "{count}",
                  String(newMessages.length),
                )
              : undefined
          }
          to="/admin/messages"
          tone="navy"
          index={3}
        />
        <DashboardCard
          icon={Quote}
          label={t("admin.dashboard.stats.testimonials")}
          value={testimonialsCount}
          to="/admin/testimonials"
          index={4}
        />
        <DashboardCard
          icon={Ship}
          label={t("admin.dashboard.stats.leads")}
          value={leads.length}
          hint={t("admin.dashboard.stats.leadsHint")}
          tone="gold"
          index={5}
        />
      </div>

      <section className="mt-10">
        <AdminSectionTitle
          eyebrow={t("admin.dashboard.actions.eyebrow")}
          title={t("admin.dashboard.actions.title")}
        />
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {quickActions.map((action, index) => {
            const Icon = action.icon;
            return (
              <motion.div
                key={action.to}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * index, duration: 0.45 }}
              >
                <Link
                  to={action.to}
                  className={cn(
                    "group flex h-full flex-col rounded-2xl border p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md",
                    index === 1
                      ? "border-white/10 bg-gradient-to-br from-navy to-ocean text-white hover:border-gold/40"
                      : "border-navy/8 bg-white hover:border-gold/45",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-11 place-items-center rounded-2xl border transition-colors",
                      index === 1
                        ? "border-gold/35 bg-gold/15 text-gold group-hover:bg-gold group-hover:text-navy"
                        : "border-navy/8 bg-sand text-navy group-hover:border-gold/40 group-hover:bg-gold",
                    )}
                  >
                    <Icon className="size-5" strokeWidth={1.45} />
                  </span>
                  <h4
                    className={cn(
                      "mt-4 font-display text-lg",
                      index === 1 ? "text-white" : "text-navy",
                    )}
                  >
                    {action.title}
                  </h4>
                  <p
                    className={cn(
                      "mt-2 flex-1 text-sm leading-relaxed",
                      index === 1 ? "text-white/60" : "text-navy/55",
                    )}
                  >
                    {action.body}
                  </p>
                  <span
                    className={cn(
                      "mt-4 inline-flex items-center gap-1 text-[0.65rem] tracking-[0.16em] uppercase transition-colors",
                      index === 1
                        ? "text-white/45 group-hover:text-gold"
                        : "text-navy/40 group-hover:text-gold",
                    )}
                  >
                    {t("admin.dashboard.viewAll")}
                    <ArrowUpRight className="size-3.5 rtl:rotate-180" strokeWidth={1.6} />
                  </span>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </section>

      <div className="mt-10 grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
        <section className="overflow-hidden rounded-2xl border border-navy/8 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-navy/8 bg-gradient-to-l from-sand/60 to-white px-5 py-4">
            <div>
              <h3 className="font-display text-xl text-navy">{t("admin.dashboard.recent")}</h3>
              <p className="mt-1 text-xs text-navy/50">{t("admin.dashboard.recentHint")}</p>
            </div>
            <Link
              to="/admin/messages"
              className="inline-flex items-center gap-1 rounded-full border border-navy/10 bg-white px-3 py-1.5 text-[0.65rem] tracking-[0.14em] text-navy/60 uppercase transition hover:border-gold/40 hover:text-navy"
            >
              {t("admin.dashboard.viewAll")}
              <ArrowUpRight className="size-3.5 rtl:rotate-180" strokeWidth={1.6} />
            </Link>
          </div>

          <div className="divide-y divide-navy/6">
            {recentInbox.map((row, index) => (
              <MessageRow key={row.id} row={row} index={index} />
            ))}
          </div>

          {leads.length > 0 ? (
            <div className="border-t border-navy/8 px-5 py-4">
              <p className="text-[0.65rem] tracking-[0.18em] text-navy/40 uppercase">
                {t("admin.dashboard.leadsTitle")}
              </p>
              <ul className="mt-3 space-y-3">
                {leads.slice(0, 3).map((lead, index) => (
                  <li
                    key={`${lead.email ?? "lead"}-${index}`}
                    className="rounded-xl border border-navy/8 bg-sand px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-navy">
                          {lead.name || t("admin.dashboard.unknownLead")}
                        </p>
                        <p className="mt-1 truncate text-xs text-navy/50" dir="ltr">
                          {lead.email || lead.phone || "—"}
                        </p>
                      </div>
                      <StatusBadge label={t("admin.status.new")} tone="active" />
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-navy/65">
                      {[lead.yachtType, lead.serviceNeeded, lead.message]
                        .filter(Boolean)
                        .join(" · ") || t("admin.dashboard.leadFallback")}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

          <section className="rounded-2xl border border-navy/8 bg-white p-5 shadow-sm">
            <AdminSectionTitle
              eyebrow={t("admin.dashboard.health.eyebrow")}
              title={t("admin.dashboard.health.title")}
            />
            <ul className="mt-5 space-y-1.5">
              {contentHealth.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      className="flex items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-gold/25 hover:bg-sand"
                    >
                      <span className="inline-flex items-center gap-3 text-sm text-navy">
                        <span className="grid size-9 place-items-center rounded-xl border border-navy/8 bg-sand text-navy">
                          <Icon className="size-3.5" strokeWidth={1.5} />
                        </span>
                        {item.label}
                      </span>
                      <span className="font-display text-lg text-navy/80">{item.value}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
      </div>
    </AdminLayout>
  );
}

function MessageRow({ row, index }: { row: MessageRecord; index: number }) {
  const { t } = useLanguage();

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-sand/80"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-gold/25 bg-gradient-to-br from-navy to-ocean text-[0.7rem] tracking-wide text-white">
        {row.name
          .split(" ")
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
          .toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="truncate text-sm font-medium text-navy">{row.name}</p>
          <StatusBadge
            label={row.status === "new" ? t("admin.status.new") : t("admin.status.read")}
            tone={row.status === "new" ? "active" : "draft"}
          />
        </div>
        <p className="mt-1 truncate text-xs text-navy/45" dir="ltr">
          {row.email}
        </p>
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-navy/70">{row.message}</p>
        <p className="mt-2 text-[0.65rem] tracking-[0.14em] text-navy/40 uppercase">{row.date}</p>
      </div>
    </motion.article>
  );
}
