import { NextResponse } from "next/server";
import { getActiveUserId } from "@/lib/active-user";
import { verifyCityOwnership } from "@/lib/ownership";

type WaypointInput = { id: string; lat: number; lon: number };

type MapboxOptimizedResponse = {
  code?: string;
  waypoints?: Array<{ waypoint_index: number; name?: string }>;
  trips?: Array<{ geometry: unknown; distance: number; duration: number }>;
};

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

  const body = (await req.json()) as { waypoints?: WaypointInput[] };
  const { waypoints } = body;

  if (!waypoints || waypoints.length < 2) {
    return NextResponse.json(
      { error: "Need at least 2 waypoints" },
      { status: 400 },
    );
  }
  if (waypoints.length > 12) {
    return NextResponse.json(
      { error: "Mapbox Optimization API supports max 12 waypoints" },
      { status: 400 },
    );
  }

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_MAPBOX_TOKEN is not configured" },
      { status: 500 },
    );
  }

  // Mapbox Optimization API v1
  // source=first / destination=last keeps the first/last waypoints fixed.
  // roundtrip=false means it's a one-way trip (A → … → Z).
  const coords = waypoints.map((w) => `${w.lon},${w.lat}`).join(";");
  const url =
    `https://api.mapbox.com/optimized-trips/v1/mapbox/walking/${coords}` +
    `?access_token=${token}&roundtrip=false&source=first&destination=last&geometries=geojson`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Mapbox error (${res.status}): ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const data = (await res.json()) as MapboxOptimizedResponse;

  if (data.code !== "Ok" || !data.waypoints || data.waypoints.length === 0) {
    return NextResponse.json(
      { error: `Mapbox returned code=${data.code ?? "unknown"}` },
      { status: 502 },
    );
  }

  // data.waypoints[i].waypoint_index is the index into the ORIGINAL waypoints array
  // for the i-th stop in the optimised tour.
  // Since source=first and destination=last, position 0 and position N-1 are pinned.
  const orderedIds = data.waypoints.map((w) => waypoints[w.waypoint_index].id);

  return NextResponse.json({ orderedIds });
}
