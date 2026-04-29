import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Trip Planner", template: "%s · Trip Planner" },
  description: "Plan your trips, cities, and points of interest.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <ToastProvider>
          <ConfirmProvider>
            <header className="border-b border-[hsl(var(--border))]">
              <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
                <Link href="/" className="text-base font-semibold sm:text-lg">
                  Trip Planner
                </Link>
                <Button asChild size="sm">
                  <Link href="/trips/new">New trip</Link>
                </Button>
              </div>
            </header>
            <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">{children}</main>
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
