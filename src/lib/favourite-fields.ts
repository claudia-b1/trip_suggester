/**
 * Extra-field definitions for favourite items.
 * Each category/subcategory can define custom fields that appear in the add/edit modal
 * and can be filtered on in the favourites panel.
 */

/* ── Shared field-type primitives ──────────────────────────────────────────── */

export type ProximityRating = "-" | "2km" | "500m" | "200m" | "direct";
export const PROXIMITY_OPTIONS: { value: ProximityRating; label: string }[] = [
  { value: "-", label: "-" },
  { value: "2km", label: "< 2 km" },
  { value: "500m", label: "< 500 m" },
  { value: "200m", label: "< 200 m" },
  { value: "direct", label: "Direct" },
];

/* ── Subcategories for ACCOMMODATION (not in the recommendation engine) ──── */

export type FavouriteSubcategoryDef = {
  id: string;
  label: string;
  emoji: string;
};

export const ACCOMMODATION_SUBCATEGORIES: FavouriteSubcategoryDef[] = [
  { id: "camping", label: "Camping", emoji: "🏕️" },
  { id: "hotel", label: "Hotel", emoji: "🏨" },
  { id: "hostel", label: "Hostel", emoji: "🏠" },
  { id: "bnb", label: "B&B", emoji: "🛏️" },
  { id: "apartment", label: "Apartment", emoji: "🏢" },
  { id: "resort", label: "Resort", emoji: "🏖️" },
  { id: "glamping", label: "Glamping", emoji: "⛺" },
  { id: "cabin", label: "Cabin / Chalet", emoji: "🏡" },
];

/* ── Field definition types ────────────────────────────────────────────────── */

export type ExtraFieldDef =
  | { type: "proximity"; key: string; label: string }
  | { type: "stars"; key: string; label: string }
  | { type: "boolean"; key: string; label: string }
  | { type: "text"; key: string; label: string }
  | { type: "select"; key: string; label: string; options: { value: string; label: string }[] };

/**
 * Returns field definitions for a given category + subcategory.
 * These drive the dynamic form in the add/edit modal and filters in the panel.
 */
export function getExtraFieldDefs(
  category: string,
  subcategory: string | null,
): ExtraFieldDef[] {
  // Only show extra fields when a subcategory is selected
  if (!subcategory) return [];

  // ── ACCOMMODATION ──
  if (category === "ACCOMMODATION") {
    if (subcategory === "camping") return CAMPING_FIELDS;
    // Generic accommodation fields for non-camping
    return ACCOMMODATION_GENERIC_FIELDS;
  }
  // ── FOOD ──
  if (category === "FOOD") return FOOD_FIELDS;
  // ── NATURE ──
  if (category === "NATURE") return NATURE_FIELDS;
  // ── ENTERTAINMENT ──
  if (category === "ENTERTAINMENT") return ENTERTAINMENT_FIELDS;
  // ── OUTDOORS ──
  if (category === "OUTDOORS") return OUTDOORS_FIELDS;
  // Others: no extra fields
  return [];
}

/* ── Per-category field definitions ────────────────────────────────────────── */

const CAMPING_FIELDS: ExtraFieldDef[] = [
  // Proximity ratings
  { type: "proximity", key: "dichtBijZee", label: "Dicht bij zee" },
  { type: "proximity", key: "dichtBijMeer", label: "Dicht bij meer" },
  // Star ratings
  { type: "stars", key: "uitzicht", label: "Uitzicht" },
  { type: "stars", key: "privacy", label: "Privacy" },
  { type: "stars", key: "sterrenCamping", label: "# sterren camping" },
  // Select fields
  { type: "select", key: "aantalM2", label: "Aantal m2", options: [
    { value: "<65", label: "< 65" },
    { value: "65-75", label: "65 - 75" },
    { value: "75-90", label: "75 - 90" },
    { value: "90-120", label: "90 - 120" },
    { value: "120+", label: "120+" },
  ]},
  // Checkboxes
  { type: "boolean", key: "wateraansluiting", label: "Wateraansluiting" },
  { type: "boolean", key: "afvoeraansluiting", label: "Afvoeraansluiting" },
  { type: "boolean", key: "electriciteit", label: "Electriciteit" },
  { type: "boolean", key: "wifiDekking", label: "WIFI dekking" },
  { type: "boolean", key: "openInWinter", label: "Open in winter" },
  { type: "boolean", key: "kleineCamping", label: "Kleine camping (<35)" },
  { type: "boolean", key: "adultsOnly", label: "Adults only" },
  { type: "boolean", key: "doorreiscamping", label: "Doorreiscamping" },
  // Text fields
  { type: "text", key: "omschrijvingLigging", label: "Omschrijving ligging" },
  { type: "text", key: "beperkingen", label: "Beperkingen" },
];

const ACCOMMODATION_GENERIC_FIELDS: ExtraFieldDef[] = [
  { type: "stars", key: "starRating", label: "Star rating" },
  { type: "boolean", key: "breakfastIncluded", label: "Breakfast included" },
  { type: "boolean", key: "parking", label: "Parking" },
  { type: "boolean", key: "petFriendly", label: "Pet friendly" },
  { type: "boolean", key: "pool", label: "Pool" },
  { type: "boolean", key: "airConditioning", label: "Air conditioning" },
];

const FOOD_FIELDS: ExtraFieldDef[] = [
  { type: "select", key: "priceLevel", label: "Price level", options: [
    { value: "1", label: "$" },
    { value: "2", label: "$$" },
    { value: "3", label: "$$$" },
    { value: "4", label: "$$$$" },
  ]},
  { type: "boolean", key: "vegetarianFriendly", label: "Vegetarian friendly" },
  { type: "boolean", key: "reservationRequired", label: "Reservation required" },
  { type: "boolean", key: "michelin", label: "Michelin star" },
];

const NATURE_FIELDS: ExtraFieldDef[] = [
  { type: "select", key: "difficulty", label: "Difficulty", options: [
    { value: "easy", label: "Easy" },
    { value: "moderate", label: "Moderate" },
    { value: "hard", label: "Hard" },
  ]},
  { type: "text", key: "durationHours", label: "Duration (hours)" },
  { type: "boolean", key: "dogFriendly", label: "Dog friendly" },
];

const OUTDOORS_FIELDS: ExtraFieldDef[] = [
  { type: "select", key: "difficulty", label: "Difficulty", options: [
    { value: "easy", label: "Easy" },
    { value: "moderate", label: "Moderate" },
    { value: "hard", label: "Hard" },
  ]},
  { type: "text", key: "distance", label: "Distance" },
  { type: "text", key: "durationHours", label: "Duration" },
  { type: "boolean", key: "guidedTour", label: "Guided tour available" },
  { type: "boolean", key: "equipmentRental", label: "Equipment rental" },
];

const ENTERTAINMENT_FIELDS: ExtraFieldDef[] = [
  { type: "select", key: "indoorOutdoor", label: "Indoor / Outdoor", options: [
    { value: "indoor", label: "Indoor" },
    { value: "outdoor", label: "Outdoor" },
    { value: "both", label: "Both" },
  ]},
  { type: "boolean", key: "kidFriendly", label: "Kid friendly" },
];

/* ── Filter helpers ────────────────────────────────────────────────────────── */

export type ExtraFieldFilter = {
  key: string;
  value: unknown; // true for booleans, specific value for selects, min rank for proximity/stars
  type?: "proximity" | "stars" | "boolean" | "select"; // field type for smart matching
};

/**
 * Proximity rank: higher = closer = better.
 * When filtering for "< 500 m", items with "< 200 m" or "Direct" also match.
 */
const PROXIMITY_RANK: Record<string, number> = {
  "-": 0,
  "2km": 1,
  "500m": 2,
  "200m": 3,
  "direct": 4,
};

/**
 * Check if an item's extraFields match a set of active filters.
 */
export function matchesExtraFieldFilters(
  extraFields: Record<string, unknown> | null | undefined,
  filters: ExtraFieldFilter[],
): boolean {
  if (filters.length === 0) return true;
  if (!extraFields) return false;
  for (const f of filters) {
    const val = extraFields[f.key];
    if (val === undefined || val === null || val === false || val === "-") return false;
    // For stars: filter means "at least this value"
    if (typeof f.value === "number" && typeof val === "number") {
      if (val < f.value) return false;
      continue;
    }
    // For proximity: filter means "at least as close" (rank-based)
    if (f.type === "proximity" && typeof f.value === "string" && typeof val === "string") {
      const filterRank = PROXIMITY_RANK[f.value] ?? 0;
      const itemRank = PROXIMITY_RANK[val] ?? 0;
      if (itemRank < filterRank) return false;
      continue;
    }
    // For specific value match (select)
    if (typeof f.value === "string" && val !== f.value) return false;
  }
  return true;
}
