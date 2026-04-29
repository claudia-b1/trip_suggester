export const TIME_SLOTS = ["MORNING", "AFTERNOON", "EVENING"] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];

export function isTimeSlot(v: unknown): v is TimeSlot {
  return typeof v === "string" && (TIME_SLOTS as readonly string[]).includes(v);
}
