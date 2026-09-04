import type { Metadata } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ScrollToTop } from "@/components/ui/scroll-to-top";
import { PageTransition } from "@/components/ui/page-transition";
import { FavouritesProvider } from "@/components/favourites/favourites-provider";
import { FavouritesPanel } from "@/components/favourites/favourites-panel";
import { AddToFavouritesModal } from "@/components/favourites/add-to-favourites-modal";
import { HeaderActions } from "@/components/favourites/header-actions";
import { UserProvider } from "@/components/user/user-provider";
import { UserOnboarding } from "@/components/user/user-onboarding";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

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
        <meta name="theme-color" content="#4F46E5" />
        <link rel="manifest" href="/manifest.json" />
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()` }} />
      </head>
      <body className={`min-h-screen flex flex-col ${inter.className}`}>
        <ToastProvider>
          <ConfirmProvider>
            <UserProvider>
            <FavouritesProvider>
              <header className="sticky top-0 z-30 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]/80 backdrop-blur-lg">
                <div className="mx-auto flex w-full items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-6 sm:py-3">
                  <Link href="/" className="flex items-center gap-2 text-base font-bold sm:text-lg group">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="h-8 w-8 shrink-0 rounded-lg shadow-sm transition-transform group-hover:scale-110">
                      <rect width="32" height="32" rx="8" fill="#4F46E5"/>
                      <path d="M8 22 Q14 16 16 20 Q18 24 24 14" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.4" strokeDasharray="2 2.5"/>
                      <circle cx="8" cy="22" r="2" fill="white" opacity="0.5"/>
                      <path d="M24 14 a5 5 0 1 0-10 0 c0 4 5 7 5 7 s5-3 5-7z" fill="white"/>
                      <circle cx="19" cy="13.5" r="2" fill="#4F46E5"/>
                    </svg>
                    <span className="text-gradient">Trip Planner</span>
                  </Link>
                  <HeaderActions />
                </div>
              </header>
              <main className="w-full flex-1 px-3 py-4 sm:px-6 sm:py-6"><PageTransition>{children}</PageTransition></main>
              <footer className="border-t border-[hsl(var(--border))] bg-[hsl(var(--card))]">
                <div className="flex w-full items-center justify-between px-3 py-3 sm:px-6 sm:py-4 text-xs text-[hsl(var(--muted-foreground))]">
                  <span>Trip Planner v0.1</span>
                  <span>Powered by Geoapify · Wikidata · Google Places</span>
                </div>
              </footer>
              <ScrollToTop />
              <FavouritesPanel />
              <AddToFavouritesModal />
            </FavouritesProvider>
            <UserOnboarding />
            </UserProvider>
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
