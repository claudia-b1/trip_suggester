import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Sizing only — colour is passed through `className` so category and semantic
// palettes (pink favourites, indigo UNESCO, per-category badges) keep working.
//
// `nav` gets a 44px touch target on mobile: few of them, and a mis-tap navigates
// away. `filter` chips stay denser — a wrapping row of 8+ at 44px would push the
// content below the fold — but clear WCAG 2.5.8 AA (24px) with room to spare.
const pillVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      size: {
        nav: "min-h-[44px] px-4 text-sm sm:min-h-0 sm:px-3 sm:py-1",
        filter: "min-h-[32px] px-3 text-xs sm:min-h-0 sm:px-2.5 sm:py-0.5",
      },
    },
    defaultVariants: { size: "filter" },
  },
);

export interface PillProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof pillVariants> {}

const Pill = React.forwardRef<HTMLButtonElement, PillProps>(
  ({ className, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(pillVariants({ size, className }))}
      {...props}
    />
  ),
);
Pill.displayName = "Pill";

export { Pill, pillVariants };
