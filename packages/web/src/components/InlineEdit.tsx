"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "@/lib/clsx";

/**
 * Click-to-edit text. Commits on blur or Cmd/Ctrl+Enter, cancels on Escape.
 * Editing feels immediate (local state) and only round-trips on commit.
 */
export function InlineEdit({
  value,
  onSave,
  multiline = false,
  placeholder,
  className,
  label,
}: {
  value: string;
  onSave: (next: string) => void | Promise<void>;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  label?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  function commit() {
    setEditing(false);
    if (draft !== value) void onSave(draft);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={label ? `Edit ${label}` : "Edit"}
        className={clsx(
          "w-full whitespace-pre-wrap rounded px-1 py-0.5 text-left hover:bg-black/5 dark:hover:bg-white/5",
          !value && "text-black/40 dark:text-white/40",
          className,
        )}
      >
        {value || placeholder || "—"}
      </button>
    );
  }

  const shared = {
    ref: ref as never,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setDraft(value);
        setEditing(false);
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        commit();
      } else if (e.key === "Enter" && !multiline) {
        commit();
      }
    },
    className: clsx(
      "w-full rounded border border-ink/40 bg-transparent px-1 py-0.5 outline-none",
      className,
    ),
  };

  return multiline ? <textarea rows={3} {...shared} /> : <input {...shared} />;
}
