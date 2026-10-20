import type { ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  actions?: (row: T) => ReactNode;
}

export function DataTable<T>({ columns, rows, getRowId, actions }: DataTableProps<T>) {
  const { t } = useLanguage();

  return (
    <div className="overflow-hidden rounded-2xl border border-navy/8 bg-white shadow-sm">
      {/* Mobile card list */}
      <div className="divide-y divide-navy/8 md:hidden">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-navy/45">{t("admin.table.empty")}</p>
        ) : (
          rows.map((row, index) => (
            <motion.article
              key={getRowId(row)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03, duration: 0.35 }}
              className="space-y-2.5 p-3.5 sm:p-4"
            >
              {columns.map((column) => (
                <div key={column.key} className="min-w-0">
                  <p className="text-[0.6rem] tracking-[0.18em] text-navy/40 uppercase">
                    {column.header}
                  </p>
                  <div className="mt-1 text-sm text-navy">{column.render(row)}</div>
                </div>
              ))}
              {actions ? (
                <div className="flex flex-wrap gap-2 border-t border-navy/6 pt-3">
                  {actions(row)}
                </div>
              ) : null}
            </motion.article>
          ))
        )}
      </div>

      {/* Desktop table */}
      <div className="admin-table-scroll hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-start text-sm">
          <thead>
            <tr className="border-b border-navy/8 bg-sand">
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    "px-4 py-4 text-start text-[0.6rem] font-medium tracking-[0.2em] text-navy/40 uppercase lg:px-5",
                    column.className,
                  )}
                >
                  {column.header}
                </th>
              ))}
              {actions ? (
                <th className="px-4 py-4 text-end text-[0.6rem] font-medium tracking-[0.2em] text-navy/40 uppercase lg:px-5">
                  {t("admin.table.actions")}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (actions ? 1 : 0)}
                  className="px-5 py-12 text-center text-sm text-navy/45"
                >
                  {t("admin.table.empty")}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <motion.tr
                  key={getRowId(row)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04, duration: 0.4 }}
                  className="border-b border-navy/6 transition-colors last:border-0 hover:bg-sand/80"
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn("px-4 py-4 align-middle lg:px-5", column.className)}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                  {actions ? (
                    <td className="px-4 py-4 text-end lg:px-5">
                      <div className="flex justify-end gap-2">{actions(row)}</div>
                    </td>
                  ) : null}
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "active" | "draft" | "scheduled" | "expired" | "paused";
}) {
  const toneClass =
    tone === "active"
      ? "bg-emerald-500/12 text-emerald-800"
      : tone === "scheduled"
        ? "bg-amber-400/15 text-amber-900"
        : tone === "expired"
          ? "bg-red-500/10 text-red-700"
          : tone === "paused"
            ? "bg-navy/8 text-navy/55"
            : "bg-navy/6 text-navy/55";
  const dotClass =
    tone === "active"
      ? "bg-emerald-600"
      : tone === "scheduled"
        ? "bg-amber-500"
        : tone === "expired"
          ? "bg-red-500"
          : tone === "paused"
            ? "bg-navy/40"
            : "bg-navy/35";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.65rem] tracking-[0.14em] uppercase",
        toneClass,
      )}
    >
      <span className={cn("size-1.5 rounded-full", dotClass)} />
      {label}
    </span>
  );
}

/** Light-switch style control for Active ↔ Draft. */
export function AdminStatusToggle({
  active,
  onChange,
  activeLabel,
  draftLabel,
  disabled,
}: {
  active: boolean;
  onChange: (next: boolean) => void;
  activeLabel: string;
  draftLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!active);
      }}
      title={active ? draftLabel : activeLabel}
      className={cn(
        "group inline-flex items-center gap-2 rounded-full border px-1.5 py-1 transition-all",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        "disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-emerald-500/25 bg-emerald-500/10"
          : "border-navy/12 bg-navy/5",
      )}
    >
      <span
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          active ? "bg-emerald-600" : "bg-navy/30",
        )}
      >
        <span
          className={cn(
            "absolute size-5 rounded-full bg-white shadow-md transition-all duration-200",
            "start-0.5",
            active && "start-[1.35rem]",
          )}
        />
      </span>
      <span
        className={cn(
          "min-w-[3.25rem] pe-1.5 text-[0.68rem] font-medium tracking-wide",
          active ? "text-emerald-800" : "text-navy/55",
        )}
      >
        {active ? activeLabel : draftLabel}
      </span>
    </button>
  );
}

export function RowAction({
  icon: Icon,
  label,
  onClick,
  tone = "default",
  confirm,
  confirmMessage,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
  /** Defaults to true for danger actions */
  confirm?: boolean;
  confirmMessage?: string;
}) {
  const { t } = useLanguage();
  const needsConfirm = confirm ?? tone === "danger";

  return (
    <button
      type="button"
      onClick={() => {
        if (needsConfirm) {
          const message = confirmMessage || t("admin.actions.confirmDelete");
          if (!window.confirm(message)) return;
        }
        onClick();
      }}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-11 place-items-center rounded-xl border transition-all",
        tone === "danger"
          ? "border-red-200 text-red-500 hover:border-red-400 hover:bg-red-50"
          : "border-navy/10 bg-white text-navy/55 hover:border-gold/45 hover:bg-gold/10 hover:text-navy",
      )}
    >
      <Icon className="size-4" strokeWidth={1.5} />
    </button>
  );
}
