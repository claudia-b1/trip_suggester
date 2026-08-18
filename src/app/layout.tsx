import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ScrollToTop } from "@/components/ui/scroll-to-top";
import { PageTransition } from "@/components/ui/page-transition";
import { FavouritesProvider } from "@/components/favourites/favourites-provider";
import { FavouritesPanel } from "@/components/favourites/favourites-panel";
import { AddToFavouritesModal } from "@/components/favourites/add-to-favourites-modal";
import { HeaderActions } from "@/components/favourites/header-actions";
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()` }} />
      </head>
      <body className="min-h-screen flex flex-col font-sans">
        <ToastProvider>
          <ConfirmProvider>
            <FavouritesProvider>
              <header className="sticky top-0 z-30 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]/80 backdrop-blur-lg">
                <div className="mx-auto flex w-full items-center justify-between gap-3 px-6 py-3">
                  <Link href="/" className="flex items-center gap-2 text-base font-bold sm:text-lg group">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm transition-transform group-hover:scale-110">
                      ✈️
                    </span>
                    <span className="text-gradient">Trip Planner</span>
                  </Link>
                  <HeaderActions />
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
              <FavouritesPanel />
              <AddToFavouritesModal />
            </FavouritesProvider>
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
