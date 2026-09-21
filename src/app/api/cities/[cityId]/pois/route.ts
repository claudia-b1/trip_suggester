import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCategory } from "@/lib/categories";
import { getActiveUserId } from "@/lib/active-user";
import { verifyCityOwnership } from "@/lib/ownership";
import { fetchGoogleMeta, resolvePhotoUri } from "@/lib/recommendations/google-places";
import { haversineKm } from "@/lib/geo";
import { validatePoiLocation } from "@/lib/validate-poi-location";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId } = await params;
  const cityIdNum = Number(cityId);
  if (!await verifyCityOwnership(cityIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const pois = await prisma.poi.findMany({
    where: { cityId: cityIdNum },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(pois);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId } = await params;
  if (!await verifyCityOwnership(Number(cityId), userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json();
  const { name, category, subcategory, description, latitude, longitude, photoUrl, website, placeId, favouriteItemId, phoneNumber, openingHours, priceLevel, fee, address, notes, resolveViaGoogle, cityName } = body;

  if (!isCategory(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const cityIdNum = Number(cityId);
  const favItemId = typeof favouriteItemId === "number" ? favouriteItemId : null;

  const city = await prisma.city.findUnique({
    where: { id: cityIdNum },
    select: { latitude: true, longitude: true, discoverRadiusKm: true },
  });

  // Optionally resolve the place via Google Places Text Search for accurate coordinates
  let resolvedLat = typeof latitude === "number" && latitude >= -90 && latitude <= 90 ? latitude : null;
  let resolvedLng = typeof longitude === "number" && longitude >= -180 && longitude <= 180 ? longitude : null;
  let resolvedPlaceId = typeof placeId === "string" && placeId ? placeId : null;
  let resolvedPhotoUrl = typeof photoUrl === "string" && photoUrl ? photoUrl : null;
  let resolvedRating: number | null = null;
  let resolvedUserRatingCount: number | null = null;
  let resolvedWebsite = typeof website === "string" && website ? website : null;
  let resolvedPhone = typeof phoneNumber === "string" ? phoneNumber : null;
  let resolvedHours = typeof openingHours === "string" ? openingHours : null;
  let resolvedPriceLevel = typeof priceLevel === "number" ? priceLevel : null;

  if (resolveViaGoogle && name && typeof cityName === "string") {
    try {
      // Use the city's own coordinates as location bias when the recommendation
      // has no coordinates — prevents Google from returning a random global match
      // (e.g. "Olive oil tasting" in Bale resolving to Ljubljana).
      let biasLat = resolvedLat ?? 0;
      let biasLng = resolvedLng ?? 0;
      if (!biasLat && !biasLng) {
        if (city?.latitude != null && city?.longitude != null) { biasLat = city.latitude; biasLng = city.longitude; }
      }
      const meta = await fetchGoogleMeta(
        name,
        cityName,
        biasLat,
        biasLng,
      );
      if (meta) {
        if (meta.latitude != null && meta.longitude != null) {
          // Sanity check: reject Google results that are too far from the city
          // (e.g. "Olive oil tasting" in Bale resolving to Ljubljana, 172km away)
          const distFromBias = haversineKm(biasLat, biasLng, meta.latitude, meta.longitude);
          if (distFromBias <= 50) {
            resolvedLat = meta.latitude;
            resolvedLng = meta.longitude;
          } else {
            console.log(`[poi-create] Google result for "${name}" is ${Math.round(distFromBias)}km from city — ignoring coordinates`);
          }
        }
        resolvedPlaceId = meta.googlePlaceId ?? resolvedPlaceId;
        resolvedRating = meta.rating ?? null;
        resolvedUserRatingCount = meta.userRatingCount ?? null;
        resolvedWebsite = meta.website ?? resolvedWebsite;
        resolvedPhone = meta.phoneNumber ?? resolvedPhone;
        resolvedHours = meta.openingHours ?? resolvedHours;
        resolvedPriceLevel = meta.priceLevel ?? resolvedPriceLevel;
        if (meta.photoName) {
          const apiKey = process.env.GOOGLE_PLACES_API_KEY;
          if (apiKey) {
            const photoUri = await resolvePhotoUri(meta.photoName, apiKey);
            if (photoUri) resolvedPhotoUrl = photoUri;
          }
        }
      }
    } catch { /* best-effort — fall back to provided coordinates */ }
  }

  // Validate resolved coordinates against the city
  const locValidation = validatePoiLocation(
    resolvedLat, resolvedLng,
    city?.latitude, city?.longitude,
    { maxDistanceKm: city?.discoverRadiusKm ?? 75 },
  );
  if (!locValidation.valid && resolvedLat != null) {
    console.log(`[poi-create] invalid coordinates for "${name}" — nulling out`);
    resolvedLat = null;
    resolvedLng = null;
  }
  let extraFields: { locationWarningKm: number } | undefined;
  if (locValidation.valid && !locValidation.nearCity && locValidation.distanceKm != null) {
    console.log(`[poi-create] "${name}" is ${locValidation.distanceKm}km from city centre`);
    extraFields = { locationWarningKm: Math.round(locValidation.distanceKm) };
  }

  const poi = await prisma.poi.create({
    data: {
      name,
      category,
      subcategory: typeof subcategory === "string" && subcategory.trim() ? subcategory.trim() : null,
      description: description || null,
      latitude: resolvedLat,
      longitude: resolvedLng,
      photoUrl: resolvedPhotoUrl,
      website: resolvedWebsite,
      placeId: resolvedPlaceId,
      phoneNumber: resolvedPhone,
      openingHours: resolvedHours,
      priceLevel: resolvedPriceLevel,
      rating: resolvedRating,
      userRatingCount: resolvedUserRatingCount,
      fee: typeof fee === "string" ? fee : null,
      address: typeof address === "string" ? address : null,
      notes: typeof notes === "string" ? notes : null,
      extraFields: extraFields ?? undefined,
      favouriteItemId: favItemId,
      cityId: cityIdNum,
    },
  });

  // If this POI is linked to a favourite, clear any previous dismissal
  // so the sync recognises it's been re-added intentionally.
  if (favItemId) {
    await prisma.dismissedFavouriteCity.deleteMany({
      where: { favouriteItemId: favItemId, cityId: cityIdNum },
    });
  }

  return NextResponse.json(
    { ...poi, _locationWarning: locValidation.warning ?? null },
    { status: 201 },
  );
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId } = await params;
  const id = Number(cityId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid cityId" }, { status: 400 });
  }
  if (!await verifyCityOwnership(id, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.poi.deleteMany({ where: { cityId: id } });
  return new NextResponse(null, { status: 204 });
}
