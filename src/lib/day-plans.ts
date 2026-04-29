import { prisma } from "@/lib/prisma";

export function eachDay(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cur = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const last = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
  );
  while (cur.getTime() <= last.getTime()) {
    days.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

export async function ensureDayPlans(cityId: number, start: Date, end: Date) {
  const days = eachDay(start, end);
  await Promise.all(
    days.map((date) =>
      prisma.dayPlan.upsert({
        where: { cityId_date: { cityId, date } },
        update: {},
        create: { cityId, date },
      }),
    ),
  );
}
