import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bot, Loader2, Printer, RefreshCw } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import { getDb } from "@/lib/firebase";
import {
  buildChatbotWeeklyReport,
  formatDelta,
  type ChatbotWeeklyReport,
  type ReportVerdict,
} from "@/lib/agent/chatbotWeeklyReport";
import { cn } from "@/lib/utils";

function formatRange(startIso: string, endIso: string, language: "ar" | "en"): string {
  const locale = language === "ar" ? "ar-SA" : "en-GB";
  const start = new Date(startIso);
  const end = new Date(endIso);
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

function verdictTone(verdict: ReportVerdict): string {
  if (verdict === "good") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (verdict === "ok") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-red-200 bg-red-50 text-red-800";
}

function Metric({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string | number;
  delta?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-navy/8 bg-sand px-3 py-3">
      <p className="text-[0.62rem] tracking-[0.14em] text-navy/45 uppercase">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="font-display text-2xl text-navy">{value}</p>
        {delta ? (
          <span
            className={cn(
              "text-xs font-medium",
              delta.startsWith("+")
                ? "text-emerald-700"
                : delta.startsWith("-")
                  ? "text-red-600"
                  : "text-navy/45",
            )}
          >
            {delta}
          </span>
        ) : null}
      </div>
      {hint ? <p className="mt-1 text-[0.65rem] text-navy/45">{hint}</p> : null}
    </div>
  );
}

export function ChatbotWeeklyReportPanel({
  className,
  showOpenAiLink = true,
}: {
  className?: string;
  showOpenAiLink?: boolean;
}) {
  const { t, language } = useLanguage();
  const [report, setReport] = useState<ChatbotWeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const printRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await buildChatbotWeeklyReport(getDb());
      setReport(next);
    } catch {
      setError(t("admin.dashboard.chatReport.loadFailed"));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onPrint = () => {
    document.body.classList.add("printing-chatbot-report");
    window.print();
    window.setTimeout(() => {
      document.body.classList.remove("printing-chatbot-report");
    }, 500);
  };

  const verdictLabel =
    report?.verdict === "good"
      ? t("admin.dashboard.chatReport.verdictGood")
      : report?.verdict === "ok"
        ? t("admin.dashboard.chatReport.verdictOk")
        : t("admin.dashboard.chatReport.verdictWeak");

  const verdictBody =
    report?.verdict === "good"
      ? t("admin.dashboard.chatReport.verdictGoodBody")
      : report?.verdict === "ok"
        ? t("admin.dashboard.chatReport.verdictOkBody")
        : t("admin.dashboard.chatReport.verdictWeakBody");

  return (
    <>
      <style>{`
        @media print {
          body.printing-chatbot-report * { visibility: hidden !important; }
          body.printing-chatbot-report .chatbot-weekly-report,
          body.printing-chatbot-report .chatbot-weekly-report * {
            visibility: visible !important;
          }
          body.printing-chatbot-report .chatbot-weekly-report {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 16px !important;
            border: none !important;
            box-shadow: none !important;
            background: white !important;
          }
          body.printing-chatbot-report .no-print { display: none !important; }
        }
      `}</style>

      <section
        ref={printRef}
        className={cn(
          "chatbot-weekly-report mt-10 overflow-hidden rounded-2xl border border-navy/8 bg-white shadow-sm",
          className,
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-navy/8 px-5 py-4">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 text-[0.65rem] tracking-[0.2em] text-gold uppercase">
              <Bot className="size-3.5" strokeWidth={1.6} />
              {t("admin.dashboard.chatReport.eyebrow")}
            </p>
            <h3 className="mt-1 font-display text-2xl text-navy">
              {t("admin.dashboard.chatReport.title")}
            </h3>
            <p className="mt-1 text-sm text-navy/55">{t("admin.dashboard.chatReport.subtitle")}</p>
            {report ? (
              <p className="mt-2 text-xs text-navy/45">
                {t("admin.dashboard.chatReport.period")}:{" "}
                {formatRange(report.currentStart, report.currentEnd, language)}
                {" · "}
                {t("admin.dashboard.chatReport.vsPrevious")}:{" "}
                {formatRange(report.previousStart, report.previousEnd, language)}
              </p>
            ) : null}
          </div>

          <div className="no-print flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full border border-navy/12 bg-sand px-4 py-2 text-xs text-navy disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {t("admin.dashboard.chatReport.refresh")}
            </button>
            <button
              type="button"
              onClick={onPrint}
              disabled={!report || loading}
              className="inline-flex items-center gap-2 rounded-full border border-gold/45 bg-gold/20 px-4 py-2 text-xs font-medium text-navy disabled:opacity-60"
            >
              <Printer className="size-3.5" />
              {t("admin.dashboard.chatReport.print")}
            </button>
            {showOpenAiLink ? (
              <Link
                to="/admin/ai"
                className="inline-flex items-center gap-2 rounded-full border border-navy/12 bg-white px-4 py-2 text-xs text-navy"
              >
                {t("admin.dashboard.chatReport.openAi")}
              </Link>
            ) : null}
          </div>
        </div>

        <div className="space-y-5 px-5 py-5">
          {loading && !report ? (
            <p className="flex items-center gap-2 text-sm text-navy/55">
              <Loader2 className="size-4 animate-spin" />
              {t("admin.dashboard.chatReport.loading")}
            </p>
          ) : null}

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          {report ? (
            <>
              <div
                className={cn(
                  "rounded-2xl border px-4 py-4",
                  verdictTone(report.verdict),
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[0.65rem] tracking-[0.16em] uppercase opacity-70">
                      {t("admin.dashboard.chatReport.verdict")}
                    </p>
                    <p className="mt-1 font-display text-2xl">{verdictLabel}</p>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed opacity-90">
                      {verdictBody}
                    </p>
                  </div>
                  <div className="rounded-xl border border-current/15 bg-white/70 px-4 py-3 text-center">
                    <p className="text-[0.65rem] tracking-[0.14em] uppercase opacity-60">
                      {t("admin.dashboard.chatReport.score")}
                    </p>
                    <p className="font-display text-3xl">{report.score}</p>
                    <p className="text-[0.65rem] opacity-60">/ 100</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                  label={t("admin.dashboard.chatReport.conversations")}
                  value={report.current.conversations}
                  delta={formatDelta(report.deltas.conversations)}
                  hint={t("admin.dashboard.chatReport.vsLastWeek")}
                />
                <Metric
                  label={t("admin.dashboard.chatReport.withPhone")}
                  value={report.current.withPhone}
                  delta={formatDelta(report.deltas.withPhone)}
                  hint={t("admin.dashboard.chatReport.withPhoneHint")}
                />
                <Metric
                  label={t("admin.dashboard.chatReport.handoff")}
                  value={report.current.handoff}
                  delta={formatDelta(report.deltas.handoff)}
                  hint={t("admin.dashboard.chatReport.handoffHint")}
                />
                <Metric
                  label={t("admin.dashboard.chatReport.conversion")}
                  value={`${report.current.conversionRate}%`}
                  delta={`${formatDelta(report.deltas.conversionRate)}%`}
                  hint={t("admin.dashboard.chatReport.conversionHint")}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                  label={t("admin.dashboard.chatReport.newLeads")}
                  value={report.current.newLeads}
                  delta={formatDelta(report.deltas.newLeads)}
                />
                <Metric
                  label={t("admin.dashboard.chatReport.potential")}
                  value={report.current.potential}
                />
                <Metric
                  label={t("admin.dashboard.chatReport.messages")}
                  value={report.current.messagesApprox}
                />
                <Metric
                  label={t("admin.dashboard.chatReport.errors")}
                  value={report.current.errorsLogged}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-navy/8 bg-sand px-4 py-4">
                  <h4 className="font-display text-lg text-navy">
                    {t("admin.dashboard.chatReport.languages")}
                  </h4>
                  <ul className="mt-3 space-y-2 text-sm text-navy/75">
                    <li className="flex justify-between gap-3">
                      <span>{t("admin.dashboard.chatReport.arabic")}</span>
                      <span className="font-medium text-navy">{report.current.arSessions}</span>
                    </li>
                    <li className="flex justify-between gap-3">
                      <span>{t("admin.dashboard.chatReport.english")}</span>
                      <span className="font-medium text-navy">{report.current.enSessions}</span>
                    </li>
                    <li className="flex justify-between gap-3">
                      <span>{t("admin.dashboard.chatReport.ctaShown")}</span>
                      <span className="font-medium text-navy">{report.current.ctasLogged}</span>
                    </li>
                    <li className="flex justify-between gap-3">
                      <span>{t("admin.dashboard.chatReport.handoffEvents")}</span>
                      <span className="font-medium text-navy">
                        {report.current.handoffsLogged}
                      </span>
                    </li>
                  </ul>
                </div>

                <div className="rounded-xl border border-navy/8 bg-sand px-4 py-4">
                  <h4 className="font-display text-lg text-navy">
                    {t("admin.dashboard.chatReport.topIntents")}
                  </h4>
                  {report.current.topIntents.length === 0 ? (
                    <p className="mt-3 text-sm text-navy/50">
                      {t("admin.dashboard.chatReport.noIntents")}
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {report.current.topIntents.map((item) => (
                        <li
                          key={item.intent}
                          className="flex items-center justify-between gap-3 text-sm text-navy/75"
                        >
                          <span className="truncate">{item.intent}</span>
                          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-navy">
                            {item.count}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-navy/8 overflow-hidden">
                <div className="border-b border-navy/8 bg-sand px-4 py-3">
                  <h4 className="font-display text-lg text-navy">
                    {t("admin.dashboard.chatReport.recentContacts")}
                  </h4>
                  <p className="mt-0.5 text-xs text-navy/50">
                    {t("admin.dashboard.chatReport.recentContactsHint")}
                  </p>
                </div>
                {report.recentContacts.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-navy/50">
                    {t("admin.dashboard.chatReport.noContacts")}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="border-b border-navy/8 text-start text-[0.65rem] tracking-[0.14em] text-navy/40 uppercase">
                          <th className="px-4 py-2.5 font-medium">{t("admin.ai.name")}</th>
                          <th className="px-4 py-2.5 font-medium">{t("admin.ai.phone")}</th>
                          <th className="px-4 py-2.5 font-medium">{t("admin.ai.intent")}</th>
                          <th className="px-4 py-2.5 font-medium">{t("admin.ai.leadStatus")}</th>
                          <th className="px-4 py-2.5 font-medium">{t("admin.ai.updated")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.recentContacts.map((row, index) => (
                          <tr key={`${row.phone}-${index}`} className="border-b border-navy/6 last:border-0">
                            <td className="px-4 py-2.5 text-navy">{row.name}</td>
                            <td className="px-4 py-2.5 text-navy" dir="ltr">
                              {row.phone}
                            </td>
                            <td className="px-4 py-2.5 text-navy/70">{row.intent}</td>
                            <td className="px-4 py-2.5 text-navy/70">
                              {row.leadStatus === "handoff"
                                ? t("admin.ai.leadHandoff")
                                : row.leadStatus === "potential"
                                  ? t("admin.ai.leadPotential")
                                  : t("admin.ai.leadNone")}
                            </td>
                            <td className="px-4 py-2.5 text-navy/55">
                              {new Date(row.at).toLocaleString(
                                language === "ar" ? "ar" : "en",
                                {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-dashed border-navy/15 bg-sand/70 px-4 py-3 text-xs leading-relaxed text-navy/55">
                <p>
                  {t("admin.dashboard.chatReport.previousSummary")
                    .replace("{conversations}", String(report.previous.conversations))
                    .replace("{phone}", String(report.previous.withPhone))
                    .replace("{handoff}", String(report.previous.handoff))
                    .replace("{conversion}", String(report.previous.conversionRate))}
                </p>
                <p className="mt-1">
                  {t("admin.dashboard.chatReport.generatedAt")}:{" "}
                  {new Date(report.generatedAt).toLocaleString(
                    language === "ar" ? "ar" : "en",
                  )}
                </p>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </>
  );
}
