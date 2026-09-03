"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui";

export default function HomePage() {
  const { user, loading } = useAuth();
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-10 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Prepare for an interview, properly.</h1>
      <p className="text-black/70 dark:text-white/70">
        Paste a job description and a company website. The app researches the company and its
        hiring process, then builds a company brief, a role breakdown, a categorised question
        bank, flashcards, and a day-by-day study schedule — all of it editable, and drillable.
      </p>
      <div className="flex justify-center gap-3">
        {loading ? null : user ? (
          <Link href="/kits">
            <Button>Go to my kits</Button>
          </Link>
        ) : (
          <>
            <Link href="/register">
              <Button>Get started</Button>
            </Link>
            <Link href="/login">
              <Button variant="ghost">Sign in</Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
