import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PLACES_API = "https://places.googleapis.com/v1";

/**
 * GET /api/pois/[poiId]/photo
 *
 * Photo proxy that resolves a fresh Google Places photo URL on demand.
 * Google Places photo URIs (lh3.googleusercontent.com) expire after a while,
 * so we re-resolve them using the stored placeId when the cached URL fails.
 *
 * Flow:
 * 1. Look up the POI's current photoUrl — if it responds 200, redirect to it.
 * 2. If 403/404, re-fetch photo from Google Places using the placeId.
 * 3. Store the new URL and redirect to it.
 * 4. Cache the redirect for 24 hours.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ poiId: string }> },
) {
  const { poiId: raw } = await params;
  const poiId = Number(raw);
  if (!Number.isInteger(poiId)) {
    return NextResponse.json({ error: "Invalid POI ID" }, { status: 400 });
  }

  const poi = await prisma.poi.findUnique({
    where: { id: poiId },
    select: { photoUrl: true, placeId: true },
  });

  if (!poi) {
    return NextResponse.json({ error: "POI not found" }, { status: 404 });
  }

  // 1a. Data URI — serve inline as binary (user-uploaded photo)
  if (poi.photoUrl?.startsWith("data:")) {
    const match = poi.photoUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      const [, mime, b64] = match;
      const buffer = Buffer.from(b64, "base64");
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  }

  // 1b. Wikipedia/Wikimedia URLs — permanent, just redirect
  if (poi.photoUrl?.includes("wikimedia.org") || poi.photoUrl?.includes("wikipedia.org")) {
    return NextResponse.redirect(poi.photoUrl, { headers: { "Cache-Control": "public, max-age=604800, immutable" } });
  }

  // 1c. Try existing URL
  if (poi.photoUrl) {
    try {
      const check = await fetch(poi.photoUrl, { method: "HEAD", redirect: "follow" });
      if (check.ok) {
        return NextResponse.redirect(poi.photoUrl, {
          status: 302,
          headers: { "Cache-Control": "public, max-age=86400" },
        });
      }
    } catch {
      // URL is broken — fall through to re-resolve
    }
  }

  // 2. Re-resolve via Google Places API
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || !poi.placeId) {
    // Can't re-resolve — return transparent 1x1 pixel
    return new NextResponse(null, { status: 404 });
  }

  try {
    // Fetch place details with just photos field
    const detailsUrl = `${PLACES_API}/places/${poi.placeId}?fields=photos&key=${apiKey}`;
    const detailsRes = await fetch(detailsUrl);
    if (!detailsRes.ok) {
      return new NextResponse(null, { status: 404 });
    }

    const details = (await detailsRes.json()) as {
      photos?: Array<{ name: string }>;
    };

    const photoName = details.photos?.[0]?.name;
    if (!photoName) {
      // No photos available — clear stale URL
      await prisma.poi.update({
        where: { id: poiId },
        data: { photoUrl: null },
      });
      return new NextResponse(null, { status: 404 });
    }

    // Resolve photo URI
    const mediaUrl =
      `${PLACES_API}/${photoName}/media` +
      `?maxHeightPx=800&maxWidthPx=1200&key=${apiKey}&skipHttpRedirect=true`;
    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) {
      return new NextResponse(null, { status: 404 });
    }

    const mediaData = (await mediaRes.json()) as { photoUri?: string };
    const freshUrl = mediaData.photoUri;
    if (!freshUrl) {
      return new NextResponse(null, { status: 404 });
    }

    // 3. Persist the fresh URL
    await prisma.poi.update({
      where: { id: poiId },
      data: { photoUrl: freshUrl },
    });

    // 4. Redirect with cache
    return NextResponse.redirect(freshUrl, {
      status: 302,
      headers: { "Cache-Control": "public, max-age=86400" },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
