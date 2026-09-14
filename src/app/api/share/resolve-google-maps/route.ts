/**
 * POST /api/share/resolve-google-maps
 *
 * Accepts a Google Maps URL (short or long), resolves it to place details,
 * and returns structured data suitable for creating a favourite item.
 *
 * Used by the /share page (Web Share Target) and the "Paste link" feature.
 */
import { NextResponse } from "next/server";
import { getActiveUserId } from "@/lib/active-user";
import { fetchGoogleMeta, resolvePhotoUri } from "@/lib/recommendations/google-places";

// ── SSRF-safe URL allowlists ─────────────────────────────────────────────────

const ALLOWED_SHORT_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
]);

const ALLOWED_LONG_HOSTS = [
  "google.com",
  "google.co.",     // regional: google.co.uk, google.co.jp, etc.
  "google.de",
  "google.fr",
  "google.it",
  "google.es",
  "google.nl",
  "google.hr",
];

function isAllowedHost(hostname: string): boolean {
  // Short URL hosts
  if (ALLOWED_SHORT_HOSTS.has(hostname)) return true;
  // Long URL hosts (with or without www./maps. prefix)
  const bare = hostname.replace(/^(www\.|maps\.)/, "");
  return ALLOWED_LONG_HOSTS.some((h) => bare === h || bare.endsWith("." + h));
}

function isPrivateIp(hostname: string): boolean {
  return /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|::1|\[::1\])/.test(hostname);
}

// ── Google Maps URL parsing ──────────────────────────────────────────────────

type ExtractedPlace = {
  name?: string;
  lat?: number;
  lng?: number;
};

function extractPlaceInfo(urlStr: string): ExtractedPlace {
  try {
    const url = new URL(urlStr);
    const path = decodeURIComponent(url.pathname);
    const fullUrl = decodeURIComponent(urlStr);
    const result: ExtractedPlace = {};

    // Extract place name from /place/NAME/ segment (do this first)
    const placeMatch = path.match(/\/place\/([^/@]+)/);
    if (placeMatch) {
      result.name = placeMatch[1].replace(/\+/g, " ").trim();
    }

    // Prefer exact place coordinates from !3d<lat>!4d<lng> in data segment.
    // These are the actual place coordinates (vs @lat,lng which is the map
    // viewport center and may differ from the place location).
    const dataMatch = fullUrl.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
    if (dataMatch) {
      result.lat = parseFloat(dataMatch[1]);
      result.lng = parseFloat(dataMatch[2]);
      return result;
    }

    // Fall back to @lat,lng viewport center from path
    const coordMatch = path.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (coordMatch) {
      result.lat = parseFloat(coordMatch[1]);
      result.lng = parseFloat(coordMatch[2]);
    }

    // Fall back to ?q= query param — may contain "lat,lng" or a place name+address
    if (result.lat == null || !result.name) {
      const q = url.searchParams.get("q");
      if (q) {
        const qMatch = q.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/);
        if (qMatch && result.lat == null) {
          result.lat = parseFloat(qMatch[1]);
          result.lng = parseFloat(qMatch[2]);
        } else if (!result.name) {
          // q contains a place name (possibly with address), e.g.
          // "O'Panuozzo Neapolitan Pizzeria, Mariastraat 35, 3511 LN Utrecht"
          // Take the first segment before a comma as the place name.
          const namePart = q.split(",")[0].trim();
          if (namePart) result.name = namePart;
        }
      }
    }

    return result;
  } catch {
    return {};
  }
}

/**
 * Follow redirects manually with SSRF protection.
 * Only follows redirects to allowed Google domains.
 *
 * Stops as soon as we reach a Google Maps URL (has /maps/ in the path),
 * because continuing will hit consent.google.com redirect loops that
 * never resolve without browser cookies.
 */
async function followRedirectsSafely(
  url: string,
  maxHops = 5,
): Promise<string> {
  let currentUrl = url;

  for (let i = 0; i < maxHops; i++) {
    const parsed = new URL(currentUrl);
    if (isPrivateIp(parsed.hostname) || parsed.protocol !== "https:") {
      throw new Error("Blocked: unsafe URL");
    }

    const res = await fetch(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });

    const location = res.headers.get("location");
    if (!location || (res.status >= 200 && res.status < 300)) {
      // No redirect — we're at the final URL
      return currentUrl;
    }

    // Resolve relative redirects
    const nextUrl = new URL(location, currentUrl).toString();
    const nextParsed = new URL(nextUrl);

    if (!isAllowedHost(nextParsed.hostname)) {
      throw new Error(`Blocked: redirect to disallowed host ${nextParsed.hostname}`);
    }

    // If the redirect target is a Google Maps URL, use it directly.
    // Don't follow further — Google will redirect to consent.google.com
    // (GDPR cookie consent) which loops infinitely without browser cookies.
    // Detect both formats:
    //   - www.google.com/maps/place/...  (path contains /maps/)
    //   - maps.google.com?q=...          (hostname starts with maps.)
    if (nextParsed.pathname.includes("/maps/") || nextParsed.hostname.startsWith("maps.")) {
      return nextUrl;
    }

    // If we hit a consent page, extract the "continue" parameter which
    // contains the actual Google Maps URL we want.
    if (nextParsed.hostname === "consent.google.com" || nextParsed.hostname === "consent.google.de") {
      const continueUrl = nextParsed.searchParams.get("continue");
      if (continueUrl) {
        const continueParsed = new URL(continueUrl);
        if (isAllowedHost(continueParsed.hostname)) {
          return continueUrl;
        }
      }
    }

    currentUrl = nextUrl;
  }

  throw new Error("Too many redirects");
}

// ── Reverse geocode helper ───────────────────────────────────────────────────

async function reverseGeocode(
  lat: number,
  lng: number,
  baseUrl: string,
): Promise<{ city: string; country: string; address?: string }> {
  try {
    const res = await fetch(
      `${baseUrl}/api/geocode?action=reverse&lat=${lat}&lng=${lng}`,
    );
    if (!res.ok) return { city: "", country: "" };
    const data = await res.json();
    return {
      city: data.city || data.place || "",
      country: data.country || "",
      address: data.formattedAddress || data.address || undefined,
    };
  } catch {
    return { city: "", country: "" };
  }
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const userId = await getActiveUserId();
  if (!userId) {
    return NextResponse.json({ error: "No active user" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const rawUrl = body?.url;
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return NextResponse.json(
      { error: "url is required" },
      { status: 400 },
    );
  }

  // 1. Validate the URL is a Google Maps URL
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return NextResponse.json(
      { error: "Invalid URL" },
      { status: 400 },
    );
  }

  if (parsed.protocol !== "https:") {
    return NextResponse.json(
      { error: "URL must use HTTPS" },
      { status: 400 },
    );
  }

  if (!isAllowedHost(parsed.hostname)) {
    return NextResponse.json(
      { error: "Not a Google Maps URL" },
      { status: 400 },
    );
  }

  try {
    // 2. Resolve short URLs → follow redirects safely
    let resolvedUrl = rawUrl.trim();
    if (ALLOWED_SHORT_HOSTS.has(parsed.hostname)) {
      resolvedUrl = await followRedirectsSafely(resolvedUrl);
    }

    // 3. Extract place name and coordinates from URL
    const extracted = extractPlaceInfo(resolvedUrl);
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;

    // 3b. Fallback: if we have a place name but no coordinates, try Google
    // Places Text Search to find the place. This handles edge cases where
    // the URL format doesn't contain extractable coordinates.
    if (extracted.lat == null && extracted.name && apiKey) {
      const meta = await fetchGoogleMeta(extracted.name, "unknown", 0, 0);
      if (meta?.latitude != null && meta?.longitude != null) {
        extracted.lat = meta.latitude;
        extracted.lng = meta.longitude;
      }
    }

    if (extracted.lat == null || extracted.lng == null) {
      return NextResponse.json(
        { error: "Could not extract location from URL. Try sharing the full URL instead of a short link." },
        { status: 422 },
      );
    }

    let lat = extracted.lat;
    let lng = extracted.lng;

    // 4. Reverse geocode to get city/country
    const baseUrl = new URL(req.url).origin;
    const geo = await reverseGeocode(lat, lng, baseUrl);

    // 5. Enrich via Google Places API (server-side)
    let name = extracted.name || "";
    let rating: number | undefined;
    let userRatingCount: number | undefined;
    let priceLevel: number | undefined;
    let photoUrl: string | undefined;
    let website: string | undefined;
    let phoneNumber: string | undefined;
    let openingHours: string | undefined;
    let editorialSummary: string | undefined;
    let sourcePlaceId: string | undefined;

    if (apiKey && name) {
      const meta = await fetchGoogleMeta(
        name,
        geo.city || "unknown",
        lat,
        lng,
      );
      if (meta) {
        sourcePlaceId = meta.googlePlaceId;
        // Prefer Google's authoritative name and coordinates
        name = meta.name || name;
        if (meta.latitude != null && meta.longitude != null) {
          lat = meta.latitude;
          lng = meta.longitude;
        }
        rating = meta.rating;
        userRatingCount = meta.userRatingCount;
        priceLevel = meta.priceLevel;
        website = meta.website;
        phoneNumber = meta.phoneNumber;
        openingHours = meta.openingHours;
        editorialSummary = meta.editorialSummary;

        if (meta.photoName) {
          photoUrl = await resolvePhotoUri(meta.photoName, apiKey);
        }
      }
    }

    return NextResponse.json({
      name,
      latitude: lat,
      longitude: lng,
      city: geo.city,
      country: geo.country,
      address: geo.address,
      rating,
      userRatingCount,
      priceLevel,
      photoUrl,
      website,
      phoneNumber,
      openingHours,
      editorialSummary,
      sourcePlaceId,
    });
  } catch (err) {
    console.error("[resolve-google-maps]", err);
    const message = err instanceof Error ? err.message : "Failed to resolve URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
