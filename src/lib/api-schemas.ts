import { z } from "zod";
import { CATEGORIES } from "@/lib/categories";
import { RECOMMENDABLE_CATEGORIES } from "@/lib/recommendations";

// ─── Shared helpers ──────────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Expected ISO date string");

/** Parse request body with a zod schema, returning a typed error response on failure. */
export function parseBody<T extends z.ZodType>(
  schema: T,
  data: unknown,
): { success: true; data: z.infer<T> } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const path = firstIssue.path.length > 0 ? `${firstIssue.path.join(".")}: ` : "";
    return { success: false, error: `${path}${firstIssue.message}` };
  }
  return { success: true, data: result.data };
}

// ─── Trip schemas ────────────────────────────────────────────────────────────

export const createTripSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  startDate: isoDate,
  endDate: isoDate,
});

export const updateTripSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  archived: z.boolean().optional(),
  coverImage: z.string().nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

// ─── City schemas ────────────────────────────────────────────────────────────

export const createCitySchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  startDate: isoDate,
  endDate: isoDate,
  nickname: z.string().max(200).optional(),
  country: z.string().max(100).optional(),
  countryCode: z.string().max(10).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  timezone: z.string().max(100).optional(),
  parentCityId: z.number().int().optional(),
  type: z.enum(["destination", "stop"]).optional(),
});

export const reorderCitiesSchema = z.object({
  cityIds: z.array(z.number().int()).min(1, "At least one city is required"),
});

// ─── POI schemas ─────────────────────────────────────────────────────────────

const categoryEnum = z.enum([...CATEGORIES] as [string, ...string[]]);

export const updatePoiSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().nullable().optional(),
  category: categoryEnum.optional(),
  website: z.string().nullable().optional(),
  phoneNumber: z.string().nullable().optional(),
  openingHours: z.string().nullable().optional(),
  fee: z.string().nullable().optional(),
  tips: z.string().nullable().optional(),
  bestTimeToVisit: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  photoUrl: z.string().nullable().optional(),
  priceLevel: z.number().int().min(0).max(4).nullable().optional(),
  estimatedDurationMinutes: z.number().int().min(0).nullable().optional(),
  extraFields: z.record(z.string(), z.unknown()).nullable().optional(),
});

// ─── Day plan schemas ────────────────────────────────────────────────────────

export const createActivitySchema = z.object({
  poiId: z.number().int({ message: "poiId must be an integer" }),
  timeSlot: z.string().min(1, "timeSlot is required"),
});

export const batchAssignSchema = z.object({
  poiId: z.number().int({ message: "poiId must be an integer" }),
  dayPlanIds: z.array(z.number().int()).min(1, "At least one dayPlanId required"),
  timeSlot: z.string().min(1, "timeSlot is required"),
});

// ─── Attachment schemas ─────────────────────────────────────────────────────

export const attachmentUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  data: z.string().min(1),
});

// ─── Discover profile schemas ───────────────────────────────────────────────

const recommendableCategoryEnum = z.enum(
  [...RECOMMENDABLE_CATEGORIES] as [string, ...string[]],
);

export const createDiscoverProfileSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  categories: z.array(recommendableCategoryEnum).min(1, "At least one category"),
  counts: z.record(z.string(), z.number().int().min(1).max(100)),
  subcats: z.record(z.string(), z.array(z.string())),
  isDefault: z.boolean().optional(),
});

export const updateDiscoverProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  categories: z.array(recommendableCategoryEnum).min(1).optional(),
  counts: z.record(z.string(), z.number().int().min(1).max(100)).optional(),
  subcats: z.record(z.string(), z.array(z.string())).optional(),
  isDefault: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });
