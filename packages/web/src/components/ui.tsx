"use client";

import { clsx } from "@/lib/clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50",
        variant === "primary" && "bg-ink text-surface hover:opacity-90",
        variant === "ghost" && "border border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5",
        variant === "danger" && "border border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400",
        className,
      )}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-ink dark:border-white/15",
        className,
      )}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={clsx(
        "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-ink dark:border-white/15",
        className,
      )}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-black/50 dark:text-white/50">{hint}</span>}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={clsx("rounded-lg border border-black/10 p-4 dark:border-white/10", className)}>
      {children}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "amber" | "red" | "blue" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-black/10 dark:bg-white/10",
        tone === "green" && "bg-green-500/15 text-green-700 dark:text-green-300",
        tone === "amber" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        tone === "red" && "bg-red-500/15 text-red-700 dark:text-red-300",
        tone === "blue" && "bg-blue-500/15 text-blue-700 dark:text-blue-300",
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-black/60 dark:text-white/60">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}
    </span>
  );
}
