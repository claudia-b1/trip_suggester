# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev          # Start dev server (listens on 0.0.0.0)
npm run build        # Production build — also serves as the full type + lint check
npx tsc --noEmit     # Type-check only (faster than full build)
npm run lint         # ESLint via Next.js
npm run db:push      # Sync schema.prisma → database (PostgreSQL on Neon)
npm run db:studio    # Open Prisma Studio at localhost:5555
npm run db:seed      # Seed sample data (deletes existing first)
```

After changing `prisma/schema.prisma`, run `npx prisma migrate dev --name <name>` to create a migration, then restart the dev server so Next.js picks up the regenerated Prisma client.

## Architecture

**Stack:** Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS v4 (CSS-first, no tailwind.config) · Prisma ORM (PostgreSQL via Neon) · Mapbox GL · OpenRouter AI (free models)

**Data hierarchy:** Trip → City → POI → DayPlan → DayActivity. Each layer cascades on delete via Prisma.

### Server vs Client boundary

- **Server components** (default): page.tsx files fetch data via Prisma directly, then pass serialized DTOs (dates as ISO strings, no Prisma objects) to client components.
- **Client components** ("use client"): all interactive UI. Mutations go through `fetch()` calls to API routes, then call `router.refresh()` to re-run server components.
- Pattern: server page loads data → passes as props → client component manages local state + optimistic updates → API call → `router.refresh()`.

### Key patterns

- **DTO types** are co-located in the client component that uses them (e.g. `PoiDTO` in `pois-section.tsx`, `DayPlanDTO` in `daily-plan.tsx`). Server pages map Prisma results to these types.
- **Categories and time slots** are string unions constrained at the app layer (`src/lib/categories.ts`, `src/lib/slots.ts`) — not DB enums.
- **DayPlans** are auto-created via `ensureDayPlans()` — one row per date in the city's date range, upserted on city page load.
- **Cross-component communication** uses `CustomEvent` dispatch (e.g. `focus-poi-on-map` event from recommendations to PoisSection).
- **AI generation** uses OpenRouter with model `nvidia/nemotron-3-super-120b-a12b:free`. Results cached in `CityInfoCache` table with compound unique `(cityId, type)` for "city-info" and "activities" types.
- **Geocoding** falls back through Google Places → Mapbox. The `/api/geocode` route handles autocomplete, forward geocode, reverse geocode, and country validation.

### Styling

Tailwind v4 CSS-first config in `globals.css` with `@theme inline` — no `tailwind.config` file. Dark mode uses class strategy with `localStorage` theme preference. CSS variables like `hsl(var(--primary))` are used throughout for theming. shadcn/ui-style components in `src/components/ui/`.

### Environment variables

- `DATABASE_URL` — PostgreSQL connection string (Neon)
- `NEXT_PUBLIC_MAPBOX_TOKEN` — Mapbox map views (client-side)
- `GEOAPIFY_API_KEY` — POI discovery
- `GOOGLE_PLACES_API_KEY` — geocoding, place search, enrichment
- `OPENROUTER_API_KEY` — AI-generated city info and activity recommendations

### File layout

- `src/app/trips/[id]/page.tsx` — Trip detail (server) with `CitiesSection` (client)
- `src/app/trips/[id]/cities/[cityId]/page.tsx` — City detail (server), the main planning page
- `src/app/trips/[id]/cities/[cityId]/city-planning-section.tsx` — Client wrapper for Discover + POIs
- `src/app/trips/[id]/cities/[cityId]/pois-section.tsx` — POI list/map/plan views with filters
- `src/app/trips/[id]/cities/[cityId]/recommendations-panel.tsx` — AI-powered Discover panel
- `src/app/trips/[id]/cities/[cityId]/activity-recommendations.tsx` — Must-do/nearby activity recommendations
- `src/lib/recommendations/` — Multi-source POI discovery pipeline (Geoapify → Google Places → Wikidata enrichment → scoring)
- `src/components/favourites/` — Global favourites system (lists, items, panel, heart button)
