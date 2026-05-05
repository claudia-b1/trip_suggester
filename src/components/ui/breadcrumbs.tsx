import Link from "next/link";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-[hsl(var(--muted-foreground))]">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={idx} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="rounded-md px-1.5 py-0.5 transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                >
                  {idx === 0 && <span className="mr-1">🏠</span>}
                  {item.label}
                </Link>
              ) : (
                <span
                  className={isLast ? "font-medium text-[hsl(var(--foreground))]" : ""}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast && (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
