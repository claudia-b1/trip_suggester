import type { Metadata } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import { Button } from "@/components/ui/button";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ScrollToTop } from "@/components/ui/scroll-to-top";
import { PageTransition } from "@/components/ui/page-transition";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()` }} />
      </head>
      <body className={`min-h-screen flex flex-col ${inter.className}`}>
        <ToastProvider>
          <ConfirmProvider>
            <header className="sticky top-0 z-30 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]/80 backdrop-blur-lg">
              <div className="mx-auto flex w-full items-center justify-between gap-3 px-6 py-3">
                <Link href="/" className="flex items-center gap-2 text-base font-bold sm:text-lg group">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm transition-transform group-hover:scale-110">
                    ✈️
                  </span>
                  <span className="text-gradient">Trip Planner</span>
                </Link>
                <div className="flex items-center gap-2">
                  <ThemeToggle />
                  <Button asChild size="sm">
                    <Link href="/trips/new">
                      <svg xmlns="http://www.w3.org/2000/svg" className="mr-1.5 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      New trip
                    </Link>
                  </Button>
                </div>
              </div>
            </header>
            <main className="w-full flex-1 px-6 py-6"><PageTransition>{children}</PageTransition></main>
            <footer className="border-t border-[hsl(var(--border))] bg-[hsl(var(--card))]">
              <div className="flex w-full items-center justify-between px-6 py-4 text-xs text-[hsl(var(--muted-foreground))]">
                <span>Trip Planner v0.1</span>
                <span>Powered by Geoapify · Wikidata · Google Places</span>
              </div>
            </footer>
            <ScrollToTop />
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
