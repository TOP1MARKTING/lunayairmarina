import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AdminCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-navy/8 bg-white p-4 shadow-sm sm:p-6",
        "bg-[linear-gradient(180deg,white_0%,color-mix(in_oklab,var(--sand)_35%,white)_100%)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AdminPrimaryButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-gold/60 bg-gold px-5 py-3 text-xs tracking-[0.18em] text-navy uppercase shadow-[0_10px_24px_-12px_rgba(200,169,106,0.65)] transition-colors hover:bg-gold-soft disabled:opacity-50 sm:w-auto",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function AdminSecondaryButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-navy/12 bg-white px-5 py-3 text-xs tracking-[0.18em] text-navy uppercase transition-colors hover:border-gold/40 hover:bg-sand disabled:opacity-50 sm:w-auto",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function AdminToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
      {children}
    </div>
  );
}

export function AdminSectionTitle({
  eyebrow,
  title,
  hint,
}: {
  eyebrow?: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      {eyebrow ? (
        <p className="text-[0.65rem] tracking-[0.2em] text-gold uppercase">{eyebrow}</p>
      ) : null}
      <h3 className="mt-1 font-display text-2xl text-navy">{title}</h3>
      {hint ? <p className="mt-1 text-xs text-navy/50">{hint}</p> : null}
    </div>
  );
}
