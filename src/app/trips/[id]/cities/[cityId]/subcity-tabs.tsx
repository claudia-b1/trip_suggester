"use client";

import { useRouter } from "next/navigation";

type SubcityTabsProps = {
  tripId: number;
  parentCity: { id: number; name: string };
  subcities: { id: number; name: string }[];
  activeCityId: number;
};

export function SubcityTabs({ tripId, parentCity, subcities, activeCityId }: SubcityTabsProps) {
  const router = useRouter();

  const tabs = [
    { id: parentCity.id, name: parentCity.name, isParent: true },
    ...subcities.map((s) => ({ id: s.id, name: s.name, isParent: false })),
  ];

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {tabs.map((tab) => {
        const isActive = tab.id === activeCityId;
        return (
          <button
            key={tab.id}
            onClick={() => !isActive && router.push(`/trips/${tripId}/cities/${tab.id}`)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] border border-[hsl(var(--secondary))]"
                : "border border-dashed border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            }`}
            aria-current={isActive ? "page" : undefined}
          >
            {tab.isParent && (
              <span className="mr-1 opacity-60">
                <svg xmlns="http://www.w3.org/2000/svg" className="inline h-3 w-3 -mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              </span>
            )}
            {tab.name}
          </button>
        );
      })}

      {/* "+ Sub-destination" button — only show when viewing the parent */}
      {activeCityId === parentCity.id && (
        <button
          onClick={() => {
            // Navigate to trip page with addCity flow for sub-destination
            const url = new URL(window.location.origin + `/trips/${tripId}`);
            url.searchParams.set("addCity", "1");
            url.searchParams.set("parentCityId", String(parentCity.id));
            router.push(url.pathname + url.search);
          }}
          className="rounded-full px-2.5 py-1 text-xs text-[hsl(var(--muted-foreground))] border border-dashed border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          + Sub-destination
        </button>
      )}
    </div>
  );
}
