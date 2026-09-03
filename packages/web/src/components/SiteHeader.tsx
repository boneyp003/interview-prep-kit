"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export function SiteHeader() {
  const { user, logout } = useAuth();
  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
        <Link href={user ? "/kits" : "/"} className="font-semibold tracking-tight">
          Interview Prep Kit
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link href="/kits" className="hover:underline">
                My kits
              </Link>
              <span className="hidden text-black/50 dark:text-white/50 sm:inline">{user.email}</span>
              <button
                onClick={() => void logout()}
                className="rounded-md border border-black/15 px-2.5 py-1 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="hover:underline">
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-md bg-ink px-3 py-1 text-surface hover:opacity-90"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
