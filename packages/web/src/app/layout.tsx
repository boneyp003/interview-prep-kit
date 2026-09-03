import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Interview Prep Kit",
  description: "Turn a job description into a personalised interview preparation kit",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AuthProvider>
          <SiteHeader />
          <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
