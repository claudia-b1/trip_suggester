"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { FavouritesButton } from "./favourites-button";

export function HeaderActions() {
  return (
    <div className="flex items-center gap-2">
      <ThemeToggle />
      <FavouritesButton />
      <Button asChild size="sm">
        <Link href="/trips/new">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="mr-1.5 h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New trip
        </Link>
      </Button>
    </div>
  );
}
