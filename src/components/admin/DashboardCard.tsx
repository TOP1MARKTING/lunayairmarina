import type { LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { Counter } from "@/components/shared/Counter";
import { useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface DashboardCardProps {
  icon: LucideIcon;
  label: string;
  value: number;
  suffix?: string;
  trend?: string;
  hint?: string;
  index?: number;
  to?: string;
  tone?: "default" | "gold" | "alert" | "navy";
}

export function DashboardCard({
  icon: Icon,
  label,
  value,
  suffix,
  trend,
  hint,
  index = 0,
  to,
  tone = "default",
}: DashboardCardProps) {
  const { t } = useLanguage();
  const isDark = tone === "navy";
  const body = (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group relative h-full overflow-hidden rounded-2xl border p-4 shadow-sm transition-all duration-500 hover:-translate-y-1 hover:shadow-md sm:p-5",
        tone === "gold" && "border-gold/35 bg-gradient-to-br from-white via-white to-gold/12",
        tone === "alert" && "border-gold/40 bg-gradient-to-br from-white to-gold/[0.08]",
        isDark && "border-white/10 bg-gradient-to-br from-navy to-ocean text-navy-foreground",
        tone === "default" && "border-navy/8 bg-white hover:border-gold/40",
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -end-10 -top-10 size-32 rounded-full transition-transform duration-500 group-hover:scale-110",
          isDark ? "bg-gold/15" : "bg-gold/10",
        )}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
      />
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p
            className={cn(
              "text-[0.6rem] tracking-[0.2em] uppercase",
              isDark ? "text-white/45" : "text-navy/40",
            )}
          >
            {label}
          </p>
          <p
            className={cn(
              "mt-2 font-display text-3xl sm:mt-3 sm:text-4xl",
              isDark ? "text-white" : "text-navy",
            )}
          >
            <Counter value={value} suffix={suffix} />
          </p>
          {trend ? <p className="mt-2 text-xs font-medium text-gold">{trend}</p> : null}
          {hint ? (
            <p
              className={cn(
                "mt-2 text-xs leading-relaxed",
                isDark ? "text-white/50" : "text-navy/50",
              )}
            >
              {hint}
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-2xl border transition-all duration-500",
            isDark
              ? "border-gold/35 bg-gold/15 text-gold group-hover:bg-gold group-hover:text-navy"
              : tone === "alert" || tone === "gold"
                ? "border-gold/40 bg-gold/20 text-navy group-hover:bg-gold"
                : "border-navy/8 bg-sand text-navy group-hover:border-gold/40 group-hover:bg-gold group-hover:text-navy",
          )}
        >
          <Icon className="size-5" strokeWidth={1.45} />
        </span>
      </div>
      {to ? (
        <span
          className={cn(
            "relative mt-4 inline-flex items-center gap-1 text-[0.65rem] tracking-[0.16em] uppercase transition-colors",
            isDark ? "text-white/45 group-hover:text-gold" : "text-navy/45 group-hover:text-gold",
          )}
        >
          {t("admin.dashboard.viewAll")}
          <ArrowUpRight className="size-3.5 rtl:rotate-180" strokeWidth={1.6} />
        </span>
      ) : null}
    </motion.div>
  );

  if (!to) return body;

  return (
    <Link to={to} className="block h-full focus-visible:outline-none">
      {body}
    </Link>
  );
}
