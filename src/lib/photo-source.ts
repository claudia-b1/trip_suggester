/** Infer the source of a POI photo from its URL pattern. */
export function getPhotoSource(photoUrl: string | null | undefined): "wikipedia" | "google" | "user" | null {
  if (!photoUrl) return null;
  if (photoUrl.startsWith("data:")) return "user";
  if (photoUrl.includes("wikimedia.org") || photoUrl.includes("wikipedia.org")) return "wikipedia";
  if (photoUrl.includes("googleusercontent.com") || photoUrl.includes("googleapis.com")) return "google";
  return null;
}

/** Short display label for photo source. */
export const PHOTO_SOURCE_LABELS: Record<string, string> = {
  wikipedia: "Wikipedia",
  google: "Google",
  user: "Uploaded",
};
