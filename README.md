# trip-planner

Minimal full-stack travel planner. **Next.js 15 (App Router)** + **TypeScript (strict)** + **Tailwind CSS v4** + **Prisma ORM (SQLite)** + **shadcn/ui**, with optional Mapbox map view and Claude-powered POI suggestions and auto-planning.

## Features

- Trips → Cities → POIs → daily plans (one model per layer, all in SQLite via Prisma).
- POI list view, Mapbox map view, and per-day planner with click-to-assign and remove.
- Client-side filters: category toggle pills + name search, applied to list and map.
- "Auto-plan with AI": one Claude call distributes POIs across days and time slots.
- "Generate Recommendations": four category-specific Claude modules called in parallel.
- System-preference dark mode, breadcrumbs, dynamic page titles, toast notifications, confirmation dialogs, skeleton loaders.

## Folder structure

```
.
├── prisma/
│   ├── schema.prisma         # Trip / City / Poi / DayPlan / DayActivity
│   └── seed.ts               # Sample trips, cities, POIs, day plans
├── src/
│   ├── app/
│   │   ├── api/              # /api/trips, /api/cities/:id/(pois|recommendations|auto-plan), …
│   │   ├── trips/
│   │   │   ├── [id]/         # Trip detail, cities section, city detail subtree
│   │   │   └── new/          # Create-trip server page + client form
│   │   ├── globals.css       # Tailwind v4 + light/dark theme tokens
│   │   ├── layout.tsx        # ToastProvider, ConfirmProvider, header
│   │   ├── loading.tsx       # Home skeleton
│   │   └── page.tsx          # Trip list
│   ├── components/ui/        # button, card, input, label, skeleton,
│   │                         #   breadcrumbs, toast, confirm-dialog
│   └── lib/
│       ├── categories.ts     # Category union + colored badges
│       ├── slots.ts          # Time-slot union
│       ├── day-plans.ts      # Auto-create one DayPlan per date in range
│       ├── prisma.ts         # Prisma client singleton
│       ├── recommendations/  # culture / food / nature / nightlife modules
│       └── utils.ts          # cn() helper
├── components.json
├── .env.example
└── package.json
```

## Run locally

```bash
# 1. Install
npm install

# 2. Set up env
cp .env.example .env
# Optional but unlocks features:
#   NEXT_PUBLIC_MAPBOX_TOKEN — enables the Mapbox map view
#   ANTHROPIC_API_KEY        — enables Auto-plan and AI recommendations

# 3. Sync schema → SQLite
npm run db:push

# 4. (Optional) Seed sample data: 2 trips, 4 cities, 12 POIs, day plans
npm run db:seed

# 5. Dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable                    | Required | Used by                                         |
| --------------------------- | -------- | ----------------------------------------------- |
| `DATABASE_URL`              | Yes      | Prisma — defaults to `file:./dev.db`            |
| `NEXT_PUBLIC_MAPBOX_TOKEN`  | No       | Map View on the city page                       |
| `ANTHROPIC_API_KEY`         | No       | Auto-plan and AI POI recommendations            |

`NEXT_PUBLIC_*` variables are inlined at dev-server start, so restart `npm run dev` after changing them.

### Useful scripts

- `npm run db:push` — sync `schema.prisma` → SQLite (`prisma/dev.db`)
- `npm run db:seed` — re-seed sample data (deletes existing first)
- `npm run db:studio` — open Prisma Studio at http://localhost:5555
- `npm run lint` — Next ESLint
- `npm run build` / `npm start` — production build and serve

## API

| Method   | Path                                                 | Notes                                                |
| -------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `GET`    | `/api/trips`                                         | List all trips                                       |
| `POST`   | `/api/trips`                                         | `{ name, startDate, endDate }`                       |
| `GET`    | `/api/trips/:id`                                     |                                                      |
| `DELETE` | `/api/trips/:id`                                     | Cascades to cities, POIs, day plans                  |
| `GET`    | `/api/trips/:id/cities`                              |                                                      |
| `POST`   | `/api/trips/:id/cities`                              | Auto-assigns next `order`                            |
| `DELETE` | `/api/trips/:id/cities/:cityId`                      |                                                      |
| `GET`    | `/api/cities/:cityId/pois`                           |                                                      |
| `POST`   | `/api/cities/:cityId/pois`                           | `{ name, category, description? }`                   |
| `DELETE` | `/api/pois/:poiId`                                   |                                                      |
| `POST`   | `/api/day-plans/:id/activities`                      | `{ poiId, timeSlot }` — assigns POI to a slot        |
| `DELETE` | `/api/day-activities/:id`                            |                                                      |
| `POST`   | `/api/cities/:cityId/auto-plan`                      | Calls Claude to distribute POIs across days          |
| `POST`   | `/api/cities/:cityId/recommendations`                | `{ categories: ("CULTURE"\|"FOOD"\|"NATURE"\|"NIGHTLIFE")[] }` |

## Notes

- No authentication, no booking, no real-time updates — by design.
- SQLite + Prisma has no native enums, so `category` and `timeSlot` are strings constrained at the app layer (`src/lib/categories.ts`, `src/lib/slots.ts`).
- Tailwind v4 is configured CSS-first via `@import "tailwindcss"` and `@theme inline`; no `tailwind.config` file. Dark mode follows the system preference.
- The Anthropic SDK uses `claude-opus-4-7` with adaptive thinking and forced `tool_use` for structured output.
- Restart the dev server after schema changes (`npm run db:push`) so Next picks up the regenerated Prisma client.
