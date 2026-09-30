/**
 * Zod schemas for LLM output.
 *
 * `api-schemas.ts` validates what users send us; this validates what the model
 * sends us, which is just as untrusted. Before this, every field was coerced
 * with `String(x ?? "")` — so an unbounded description or an invented category
 * flowed straight through to the UI and to the POI-create path.
 *
 * Items are validated individually and bad ones dropped, rather than failing the
 * whole batch: a single malformed entry shouldn't discard nine good ones.
 */
import { z } from "zod";
import { CATEGORIES } from "@/lib/categories";

// Generous enough never to clip a legitimate value, tight enough that a runaway
// generation can't push megabytes into the cache and the page.
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 1000;
const SHORT_MAX = 100;

/**
 * Over-long values are truncated rather than rejected. A model that rambles
 * still produced usable content, and dropping the field entirely loses more
 * than clipping it does — but the cap still has to hold, so the cache and the
 * page can't be filled by a runaway generation.
 */
const capped = (max: number) =>
  z.string().transform((s) => {
    const trimmed = s.trim();
    return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
  });

const title = capped(TITLE_MAX).pipe(z.string().min(1));
const description = capped(DESCRIPTION_MAX).catch("").default("");
const shortText = capped(SHORT_MAX).pipe(z.string().min(1)).optional().catch(undefined);

/** The model is told to use these, but regularly invents its own. */
const category = z
  .string()
  .transform((s) => s.toUpperCase().trim())
  .refine((s): s is (typeof CATEGORIES)[number] => (CATEGORIES as readonly string[]).includes(s))
  .optional()
  .catch(undefined);

const latitude = z.number().gte(-90).lte(90).optional().catch(undefined);
const longitude = z.number().gte(-180).lte(180).optional().catch(undefined);

/**
 * Placeholder text the model emits when it echoes the prompt's own example
 * schema instead of filling it in.
 */
const TEMPLATE_PREFIXES = ["short ", "1-2 sentence", "name of ", "brief ", "e.g. "];
function isTemplatePlaceholder(s: string): boolean {
  const lower = s.toLowerCase().trim();
  if (lower === "..." || lower === "…" || lower === "string" || lower === "null") return true;
  return TEMPLATE_PREFIXES.some((p) => lower.startsWith(p));
}

const realTitle = title.refine((s) => !isTemplatePlaceholder(s), {
  message: "looks like an unfilled template placeholder",
});

export const activityRecommendationSchema = z.object({
  title: realTitle,
  description,
  linkedPlace: capped(TITLE_MAX)
    .pipe(z.string().min(1).refine((s) => s.toLowerCase() !== "null" && !isTemplatePlaceholder(s)))
    .optional().catch(undefined),
  category,
  latitude,
  longitude,
});

export const nearbyCitySchema = z.object({
  name: realTitle,
  description,
  distance: shortText,
  country: shortText,
  latitude,
  longitude,
});

export const nearbyActivitySchema = z.object({
  title: realTitle,
  description,
  location: capped(SHORT_MAX).catch("").default(""),
  distance: shortText,
  category,
  latitude,
  longitude,
});

export const routeSchema = z.object({
  title: realTitle,
  description,
  distance: shortText,
  duration: shortText,
  difficulty: shortText,
  startLocation: shortText,
  latitude,
  longitude,
});

/**
 * Validate a list of model-produced items, dropping those that fail.
 * Returns the survivors plus how many were rejected, so callers can log or
 * surface the fact that the model produced junk.
 */
export function parseItems<T extends z.ZodType>(
  schema: T,
  raw: unknown,
  limit: number,
): { items: z.infer<T>[]; rejected: number } {
  if (!Array.isArray(raw)) return { items: [], rejected: 0 };

  const items: z.infer<T>[] = [];
  let rejected = 0;

  for (const entry of raw) {
    if (items.length >= limit) break;
    const result = schema.safeParse(entry);
    if (result.success) items.push(result.data);
    else rejected++;
  }

  return { items, rejected };
}
