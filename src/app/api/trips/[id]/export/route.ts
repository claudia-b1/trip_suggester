import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyTripOwnership } from "@/lib/ownership";
import { CATEGORY_LABELS, type Category, isCategory } from "@/lib/categories";
import { type TimeSlot, isTimeSlot } from "@/lib/slots";

const SLOT_LABELS: Record<TimeSlot, string> = {
  MORNING: "Morning",
  AFTERNOON: "Afternoon",
  EVENING: "Evening",
};

const SLOT_ORDER: Record<TimeSlot, number> = {
  MORNING: 0,
  AFTERNOON: 1,
  EVENING: 2,
};

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateRange(start: Date, end: Date): string {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function categoryLabel(cat: string): string {
  return isCategory(cat) ? CATEGORY_LABELS[cat as Category] : cat;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) {
    return NextResponse.json({ error: "No active user" }, { status: 401 });
  }

  const { id } = await params;
  const tripId = Number(id);
  if (!Number.isInteger(tripId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  if (!(await verifyTripOwnership(tripId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      cities: {
        orderBy: { startDate: "asc" },
        include: {
          pois: { orderBy: { createdAt: "asc" } },
          dayPlans: {
            orderBy: { date: "asc" },
            include: {
              activities: {
                orderBy: { order: "asc" },
                include: { poi: true },
              },
            },
          },
        },
      },
    },
  });

  if (!trip) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tripDays =
    Math.round(
      (trip.endDate.getTime() - trip.startDate.getTime()) / 86400000,
    ) + 1;

  // Build HTML for each city
  let citiesHtml = "";
  // Only show top-level cities; subcities are rendered under their parent
  const topLevelCities = trip.cities.filter((c) => !c.parentCityId);

  for (let ci = 0; ci < topLevelCities.length; ci++) {
    const city = topLevelCities[ci];
    const cityDays =
      Math.round(
        (city.endDate.getTime() - city.startDate.getTime()) / 86400000,
      ) + 1;

    // Collect subcities
    const subcities = trip.cities.filter((c) => c.parentCityId === city.id);

    citiesHtml += `
      <div class="city-section${ci > 0 ? " page-break" : ""}">
        <div class="city-header">
          <h2>${escapeHtml(city.nickname ?? city.name)}${city.country ? `, ${escapeHtml(city.country)}` : ""}</h2>
          <p class="city-meta">${formatDateRange(city.startDate, city.endDate)} &middot; ${cityDays} day${cityDays === 1 ? "" : "s"}</p>
        </div>`;

    // Render city day plans
    citiesHtml += renderDayPlans(city.dayPlans, city.pois);

    // Render subcities
    for (const sub of subcities) {
      const subDays =
        Math.round(
          (sub.endDate.getTime() - sub.startDate.getTime()) / 86400000,
        ) + 1;
      citiesHtml += `
        <div class="subcity-section">
          <h3 class="subcity-header">${escapeHtml(sub.nickname ?? sub.name)}${sub.country ? `, ${escapeHtml(sub.country)}` : ""}</h3>
          <p class="city-meta">${formatDateRange(sub.startDate, sub.endDate)} &middot; ${subDays} day${subDays === 1 ? "" : "s"}</p>`;
      citiesHtml += renderDayPlans(sub.dayPlans, sub.pois);
      citiesHtml += `</div>`;
    }

    citiesHtml += `</div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(trip.name)} – Trip Itinerary</title>
<style>
  @page {
    margin: 1.5cm;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1a1a1a;
    background: #fff;
    line-height: 1.5;
    font-size: 13px;
    padding: 2rem;
  }

  .trip-header {
    text-align: center;
    padding-bottom: 1.5rem;
    border-bottom: 2px solid #e5e7eb;
    margin-bottom: 2rem;
  }

  .trip-header h1 {
    font-size: 1.75rem;
    font-weight: 700;
    color: #111;
    margin-bottom: 0.25rem;
  }

  .trip-meta {
    color: #6b7280;
    font-size: 0.9rem;
  }

  .city-section {
    margin-bottom: 2rem;
  }

  .city-header {
    background: #f3f4f6;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-bottom: 1rem;
  }

  .city-header h2 {
    font-size: 1.3rem;
    font-weight: 700;
    color: #111;
  }

  .city-meta {
    color: #6b7280;
    font-size: 0.85rem;
    margin-top: 0.125rem;
  }

  .subcity-section {
    margin: 1.5rem 0 1.5rem 1rem;
    padding-left: 1rem;
    border-left: 3px solid #d1d5db;
  }

  .subcity-header {
    font-size: 1.1rem;
    font-weight: 600;
    color: #374151;
  }

  .day-section {
    margin-bottom: 1.25rem;
  }

  .day-header {
    font-size: 0.95rem;
    font-weight: 600;
    color: #374151;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 0.25rem;
    margin-bottom: 0.5rem;
  }

  .slot-section {
    margin-bottom: 0.75rem;
    margin-left: 0.75rem;
  }

  .slot-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
  }

  .activity {
    padding: 0.35rem 0 0.35rem 0.75rem;
    border-left: 2px solid #d1d5db;
    margin-bottom: 0.35rem;
  }

  .activity-name {
    font-weight: 600;
    color: #111;
  }

  .activity-category {
    display: inline-block;
    font-size: 0.7rem;
    color: #6b7280;
    background: #f3f4f6;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    margin-left: 0.35rem;
    vertical-align: middle;
  }

  .activity-detail {
    font-size: 0.8rem;
    color: #6b7280;
    margin-top: 0.1rem;
  }

  .no-activities {
    color: #9ca3af;
    font-style: italic;
    font-size: 0.85rem;
    margin-left: 0.75rem;
  }

  .unassigned-section {
    margin-top: 1.25rem;
    padding-top: 0.75rem;
    border-top: 1px dashed #d1d5db;
  }

  .unassigned-section h4 {
    font-size: 0.9rem;
    font-weight: 600;
    color: #6b7280;
    margin-bottom: 0.5rem;
  }

  .poi-item {
    padding: 0.3rem 0;
    padding-left: 0.75rem;
    border-left: 2px solid #e5e7eb;
    margin-bottom: 0.25rem;
  }

  .poi-name {
    font-weight: 500;
  }

  .poi-detail {
    font-size: 0.8rem;
    color: #6b7280;
  }

  .page-break {
    page-break-before: always;
  }

  .empty-note {
    color: #9ca3af;
    font-style: italic;
    text-align: center;
    padding: 2rem;
  }

  .footer {
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid #e5e7eb;
    text-align: center;
    font-size: 0.75rem;
    color: #9ca3af;
  }

  @media print {
    body {
      padding: 0;
      font-size: 11px;
    }

    .trip-header {
      padding-bottom: 1rem;
      margin-bottom: 1.5rem;
    }

    .page-break {
      page-break-before: always;
    }

    .city-section {
      page-break-inside: avoid;
    }

    .day-section {
      page-break-inside: avoid;
    }

    .no-print {
      display: none;
    }
  }

  @media screen {
    body {
      max-width: 800px;
      margin: 0 auto;
    }

    .print-btn-bar {
      position: sticky;
      top: 0;
      background: #fff;
      border-bottom: 1px solid #e5e7eb;
      padding: 0.75rem 0;
      margin-bottom: 1rem;
      text-align: center;
      z-index: 10;
    }

    .print-btn {
      background: #4f46e5;
      color: #fff;
      border: none;
      padding: 0.5rem 1.5rem;
      border-radius: 6px;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
    }

    .print-btn:hover {
      background: #4338ca;
    }
  }
</style>
</head>
<body>
<div class="print-btn-bar no-print">
  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
</div>

<div class="trip-header">
  <h1>${escapeHtml(trip.name)}</h1>
  <p class="trip-meta">
    ${formatDateRange(trip.startDate, trip.endDate)} &middot; ${tripDays} day${tripDays === 1 ? "" : "s"} &middot;
    ${topLevelCities.length} destination${topLevelCities.length === 1 ? "" : "s"}
  </p>
</div>

${citiesHtml || '<p class="empty-note">No destinations added to this trip yet.</p>'}

<div class="footer no-print">
  Generated from Trip Planner
</div>

<script>window.onload = () => window.print();</script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

// ---------- helpers ----------

interface DayPlanWithActivities {
  id: number;
  date: Date;
  activities: {
    id: number;
    timeSlot: string;
    order: number;
    poi: {
      id: number;
      name: string;
      category: string;
      description: string | null;
      address: string | null;
      latitude: number | null;
      longitude: number | null;
    };
  }[];
}

interface PoiRow {
  id: number;
  name: string;
  category: string;
  description: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

function renderDayPlans(
  dayPlans: DayPlanWithActivities[],
  pois: PoiRow[],
): string {
  let html = "";

  if (dayPlans.length === 0 && pois.length === 0) {
    html += '<p class="no-activities">No itinerary planned.</p>';
    return html;
  }

  // Day-by-day itinerary
  for (const dp of dayPlans) {
    html += `<div class="day-section">`;
    html += `<div class="day-header">${formatDate(dp.date)}</div>`;

    if (dp.activities.length === 0) {
      html += '<p class="no-activities">No activities planned for this day.</p>';
    } else {
      // Group by time slot
      const bySlot = new Map<TimeSlot, typeof dp.activities>();
      for (const act of dp.activities) {
        const slot: TimeSlot = isTimeSlot(act.timeSlot)
          ? act.timeSlot
          : "MORNING";
        if (!bySlot.has(slot)) bySlot.set(slot, []);
        bySlot.get(slot)!.push(act);
      }

      // Render in slot order
      const orderedSlots = [...bySlot.entries()].sort(
        (a, b) => SLOT_ORDER[a[0]] - SLOT_ORDER[b[0]],
      );

      for (const [slot, activities] of orderedSlots) {
        html += `<div class="slot-section">`;
        html += `<div class="slot-label">${SLOT_LABELS[slot]}</div>`;
        for (const act of activities) {
          html += `<div class="activity">`;
          html += `<span class="activity-name">${escapeHtml(act.poi.name)}</span>`;
          html += `<span class="activity-category">${categoryLabel(act.poi.category)}</span>`;

          const details: string[] = [];
          if (act.poi.description) {
            details.push(escapeHtml(act.poi.description));
          }
          if (act.poi.address) {
            details.push(escapeHtml(act.poi.address));
          } else if (
            act.poi.latitude != null &&
            act.poi.longitude != null
          ) {
            details.push(
              `${act.poi.latitude.toFixed(4)}, ${act.poi.longitude.toFixed(4)}`,
            );
          }
          if (details.length > 0) {
            html += `<div class="activity-detail">${details.join(" &middot; ")}</div>`;
          }

          html += `</div>`;
        }
        html += `</div>`;
      }
    }

    html += `</div>`;
  }

  // Unassigned POIs (those not in any day plan activity)
  const assignedPoiIds = new Set(
    dayPlans.flatMap((dp) => dp.activities.map((a) => a.poi.id)),
  );
  const unassigned = pois.filter((p) => !assignedPoiIds.has(p.id));

  if (unassigned.length > 0) {
    html += `<div class="unassigned-section">`;
    html += `<h4>Saved Places (not yet scheduled)</h4>`;
    for (const poi of unassigned) {
      html += `<div class="poi-item">`;
      html += `<span class="poi-name">${escapeHtml(poi.name)}</span>`;
      html += `<span class="activity-category">${categoryLabel(poi.category)}</span>`;

      const details: string[] = [];
      if (poi.description) details.push(escapeHtml(poi.description));
      if (poi.address) {
        details.push(escapeHtml(poi.address));
      } else if (poi.latitude != null && poi.longitude != null) {
        details.push(
          `${poi.latitude.toFixed(4)}, ${poi.longitude.toFixed(4)}`,
        );
      }
      if (details.length > 0) {
        html += `<div class="poi-detail">${details.join(" &middot; ")}</div>`;
      }

      html += `</div>`;
    }
    html += `</div>`;
  }

  return html;
}
