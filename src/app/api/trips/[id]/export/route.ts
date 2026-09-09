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
  req: Request,
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

  // Parse selected city IDs from query string (if provided)
  const url = new URL(req.url);
  const cityIdParams = url.searchParams.getAll("cities");
  const selectedCityIds = cityIdParams.length > 0
    ? new Set(cityIdParams.map(Number).filter((n) => Number.isInteger(n)))
    : null; // null = include all

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      cities: {
        orderBy: { startDate: "asc" },
        include: {
          dayPlans: {
            orderBy: { date: "asc" },
            include: {
              activities: {
                orderBy: { order: "asc" },
                include: { poi: true },
              },
              notes: {
                orderBy: { createdAt: "asc" },
                select: { id: true, content: true },
              },
            },
          },
          notes: {
            where: { dayPlanId: null },
            orderBy: { createdAt: "asc" },
            select: { id: true, content: true },
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

  // Filter cities by selection
  const filteredCities = selectedCityIds
    ? trip.cities.filter((c) => selectedCityIds.has(c.id))
    : trip.cities;

  // Build HTML for each city
  let citiesHtml = "";
  // Only show top-level cities; subcities are rendered under their parent
  const topLevelCities = filteredCities.filter((c) => !c.parentCityId);

  let renderedCount = 0;
  for (const city of topLevelCities) {
    const cityDays =
      Math.round(
        (city.endDate.getTime() - city.startDate.getTime()) / 86400000,
      ) + 1;

    // Collect subcities (only selected ones)
    const subcities = filteredCities.filter((c) => c.parentCityId === city.id);

    // For travel stops: skip if no scheduled activities, no notes, no subcities with content
    if (city.type === "stop") {
      const hasScheduled = city.dayPlans.some((dp) => dp.activities.length > 0);
      const hasCityNotes = city.notes.some((n) => n.content.trim());
      const hasDayNotes = city.dayPlans.some((dp) => dp.notes.some((n) => n.content.trim()));
      const hasSubcityContent = subcities.length > 0;
      if (!hasScheduled && !hasCityNotes && !hasDayNotes && !hasSubcityContent) {
        continue;
      }
    }

    const isStop = city.type === "stop";

    // Collect unique accommodation POIs from scheduled activities
    const accommodations = collectAccommodations(city.dayPlans);

    citiesHtml += `
      <div class="city-section${renderedCount > 0 ? " page-break" : ""}">
        <div class="city-header${isStop ? " stop-header" : ""}">
          <h2>${isStop ? "🚗 " : ""}${escapeHtml(city.nickname ?? city.name)}${city.country ? `, ${escapeHtml(city.country)}` : ""}</h2>
          <p class="city-meta">${formatDateRange(city.startDate, city.endDate)} &middot; ${cityDays} day${cityDays === 1 ? "" : "s"}${isStop ? " &middot; Travel stop" : ""}</p>
          ${renderAccommodationBlock(accommodations)}
        </div>`;

    // City-level notes
    citiesHtml += renderNotes(city.notes);

    // Render city day plans (scheduled only, with day notes)
    citiesHtml += renderDayPlans(city.dayPlans);

    // Render subcities
    for (const sub of subcities) {
      const subDays =
        Math.round(
          (sub.endDate.getTime() - sub.startDate.getTime()) / 86400000,
        ) + 1;

      // For travel stop subcities: skip if empty
      if (sub.type === "stop") {
        const hasScheduled = sub.dayPlans.some((dp) => dp.activities.length > 0);
        const hasCityNotes = sub.notes.some((n) => n.content.trim());
        const hasDayNotes = sub.dayPlans.some((dp) => dp.notes.some((n) => n.content.trim()));
        if (!hasScheduled && !hasCityNotes && !hasDayNotes) {
          continue;
        }
      }

      const isSubStop = sub.type === "stop";
      const subAccommodations = collectAccommodations(sub.dayPlans);
      citiesHtml += `
        <div class="subcity-section">
          <h3 class="subcity-header">${isSubStop ? "🚗 " : ""}${escapeHtml(sub.nickname ?? sub.name)}${sub.country ? `, ${escapeHtml(sub.country)}` : ""}</h3>
          <p class="city-meta">${formatDateRange(sub.startDate, sub.endDate)} &middot; ${subDays} day${subDays === 1 ? "" : "s"}${isSubStop ? " &middot; Travel stop" : ""}</p>
          ${renderAccommodationBlock(subAccommodations)}`;
      citiesHtml += renderNotes(sub.notes);
      citiesHtml += renderDayPlans(sub.dayPlans);
      citiesHtml += `</div>`;
    }

    citiesHtml += `</div>`;
    renderedCount++;
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

  .city-header.stop-header {
    background: #fefce8;
    border: 1px dashed #d4b44e;
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

  .accommodation-block {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid #e5e7eb;
  }

  .accommodation-name {
    font-weight: 600;
    font-size: 0.9rem;
    color: #374151;
  }

  .accommodation-detail {
    font-size: 0.8rem;
    color: #4b5563;
    margin-top: 0.15rem;
    line-height: 1.4;
    white-space: pre-wrap;
  }

  .accommodation-meta {
    font-size: 0.75rem;
    color: #6b7280;
    margin-top: 0.15rem;
  }

  .accommodation-meta span {
    display: inline-block;
    margin-right: 0.75rem;
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
    padding: 0.5rem 0 0.5rem 0.75rem;
    border-left: 2px solid #d1d5db;
    margin-bottom: 0.5rem;
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
    color: #4b5563;
    margin-top: 0.2rem;
    line-height: 1.4;
  }

  .activity-meta {
    font-size: 0.75rem;
    color: #6b7280;
    margin-top: 0.15rem;
  }

  .activity-meta span {
    display: inline-block;
    margin-right: 0.75rem;
  }

  .no-activities {
    color: #9ca3af;
    font-style: italic;
    font-size: 0.85rem;
    margin-left: 0.75rem;
  }

  .notes-block {
    margin: 0.5rem 0 1rem 0;
    padding: 0.5rem 0.75rem;
    background: #fffbeb;
    border-left: 3px solid #f59e0b;
    border-radius: 0 4px 4px 0;
    font-size: 0.85rem;
    color: #92400e;
    white-space: pre-wrap;
  }

  .notes-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #b45309;
    margin-bottom: 0.15rem;
  }

  .day-notes {
    margin: 0.25rem 0 0.5rem 0.75rem;
    padding: 0.35rem 0.6rem;
    background: #fffbeb;
    border-left: 2px solid #f59e0b;
    border-radius: 0 3px 3px 0;
    font-size: 0.8rem;
    color: #92400e;
    white-space: pre-wrap;
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

    .save-btn-bar {
      position: sticky;
      top: 0;
      background: #fff;
      border-bottom: 1px solid #e5e7eb;
      padding: 0.75rem 0;
      margin-bottom: 1rem;
      text-align: center;
      z-index: 10;
    }

    .save-btn {
      background: #4f46e5;
      color: #fff;
      border: none;
      padding: 0.5rem 1.5rem;
      border-radius: 6px;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
    }

    .save-btn:hover {
      background: #4338ca;
    }
  }
</style>
</head>
<body>
<div class="save-btn-bar no-print">
  <button class="save-btn" onclick="window.print()">💾 Save as PDF</button>
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
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

// ---------- helpers ----------

interface NoteRow {
  id: number;
  content: string;
}

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
      phoneNumber: string | null;
      openingHours: string | null;
      latitude: number | null;
      longitude: number | null;
    };
  }[];
  notes: NoteRow[];
}

type AccommodationInfo = {
  id: number;
  name: string;
  description: string | null;
  address: string | null;
  phoneNumber: string | null;
  openingHours: string | null;
};

/** Collect unique accommodation POIs from scheduled activities */
function collectAccommodations(dayPlans: DayPlanWithActivities[]): AccommodationInfo[] {
  const seen = new Set<number>();
  const result: AccommodationInfo[] = [];
  for (const dp of dayPlans) {
    for (const act of dp.activities) {
      if (act.poi.category === "ACCOMMODATION" && !seen.has(act.poi.id)) {
        seen.add(act.poi.id);
        result.push({
          id: act.poi.id,
          name: act.poi.name,
          description: act.poi.description,
          address: act.poi.address,
          phoneNumber: act.poi.phoneNumber,
          openingHours: act.poi.openingHours,
        });
      }
    }
  }
  return result;
}

/** Render accommodation details block inside city header */
function renderAccommodationBlock(accommodations: AccommodationInfo[]): string {
  if (accommodations.length === 0) return "";
  let html = "";
  for (const acc of accommodations) {
    html += `<div class="accommodation-block">`;
    html += `<div class="accommodation-name">🏠 ${escapeHtml(acc.name)}</div>`;
    if (acc.description) {
      html += `<div class="accommodation-detail">${escapeHtml(acc.description)}</div>`;
    }
    const meta: string[] = [];
    if (acc.address) meta.push(`<span>📍 ${escapeHtml(acc.address)}</span>`);
    if (acc.openingHours) meta.push(`<span>🕐 ${escapeHtml(acc.openingHours)}</span>`);
    if (acc.phoneNumber) meta.push(`<span>📞 ${escapeHtml(acc.phoneNumber)}</span>`);
    if (meta.length > 0) {
      html += `<div class="accommodation-meta">${meta.join("")}</div>`;
    }
    html += `</div>`;
  }
  return html;
}

/** Render city-level notes */
function renderNotes(notes: NoteRow[]): string {
  const nonEmpty = notes.filter((n) => n.content.trim());
  if (nonEmpty.length === 0) return "";
  let html = "";
  for (const note of nonEmpty) {
    html += `<div class="notes-block"><div class="notes-label">Notes</div>${escapeHtml(note.content)}</div>`;
  }
  return html;
}

function renderDayPlans(
  dayPlans: DayPlanWithActivities[],
): string {
  let html = "";

  if (dayPlans.length === 0) {
    return html;
  }

  // Day-by-day itinerary
  for (const dp of dayPlans) {
    html += `<div class="day-section">`;
    html += `<div class="day-header">${formatDate(dp.date)}</div>`;

    // Day-level notes
    const dayNotes = dp.notes.filter((n) => n.content.trim());
    if (dayNotes.length > 0) {
      for (const note of dayNotes) {
        html += `<div class="day-notes">${escapeHtml(note.content)}</div>`;
      }
    }

    if (dp.activities.length === 0 && dayNotes.length === 0) {
      html += '<p class="no-activities">No activities planned for this day.</p>';
    } else if (dp.activities.length > 0) {
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

          // Accommodation details are shown in the city header — only name in timeline
          if (act.poi.category !== "ACCOMMODATION") {
            // Description
            if (act.poi.description) {
              html += `<div class="activity-detail">${escapeHtml(act.poi.description)}</div>`;
            }

            // Meta line: address, phone, opening hours
            const meta: string[] = [];
            if (act.poi.address) {
              meta.push(`<span>📍 ${escapeHtml(act.poi.address)}</span>`);
            }
            if (act.poi.openingHours) {
              meta.push(`<span>🕐 ${escapeHtml(act.poi.openingHours)}</span>`);
            }
            if (act.poi.phoneNumber) {
              meta.push(`<span>📞 ${escapeHtml(act.poi.phoneNumber)}</span>`);
            }
            if (meta.length > 0) {
              html += `<div class="activity-meta">${meta.join("")}</div>`;
            }
          }

          html += `</div>`;
        }
        html += `</div>`;
      }
    }

    html += `</div>`;
  }

  return html;
}
