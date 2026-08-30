import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function eachDay(start: Date, end: Date): Date[] {
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

async function main() {
  await prisma.dayActivity.deleteMany();
  await prisma.dayPlan.deleteMany();
  await prisma.poi.deleteMany();
  await prisma.city.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();

  // Create default user for seed data
  const user = await prisma.user.create({
    data: { name: "Me", color: "#3B82F6" },
  });

  await prisma.trip.create({
    data: {
      name: "Tokyo, autumn 2026",
      startDate: new Date("2026-10-12"),
      endDate: new Date("2026-10-22"),
      userId: user.id,
      cities: {
        create: [
          {
            name: "Tokyo",
            startDate: new Date("2026-10-12"),
            endDate: new Date("2026-10-18"),
            order: 0,
            pois: {
              create: [
                {
                  name: "Sensoji Temple",
                  category: "CULTURE",
                  description: "Iconic Buddhist temple in Asakusa.",
                  latitude: 35.7148,
                  longitude: 139.7967,
                },
                {
                  name: "Tsukiji Outer Market",
                  category: "FOOD",
                  description: "Street food and seafood stalls.",
                  latitude: 35.6655,
                  longitude: 139.7708,
                },
                {
                  name: "Yoyogi Park",
                  category: "NATURE",
                  description: "Large city park next to Meiji Shrine.",
                  latitude: 35.672,
                  longitude: 139.6949,
                },
              ],
            },
          },
          {
            name: "Kyoto",
            startDate: new Date("2026-10-18"),
            endDate: new Date("2026-10-22"),
            order: 1,
            pois: {
              create: [
                {
                  name: "Fushimi Inari Shrine",
                  category: "CULTURE",
                  description: "Thousands of vermilion torii gates.",
                  latitude: 34.9671,
                  longitude: 135.7727,
                },
                {
                  name: "Nishiki Market",
                  category: "FOOD",
                  description: "Covered market known as 'Kyoto's kitchen'.",
                  latitude: 35.005,
                  longitude: 135.7649,
                },
                {
                  name: "Arashiyama Bamboo Grove",
                  category: "OUTDOORS",
                  description: "Walk through towering bamboo.",
                  latitude: 35.0094,
                  longitude: 135.672,
                },
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.trip.create({
    data: {
      name: "Lisbon weekend",
      startDate: new Date("2026-06-05"),
      endDate: new Date("2026-06-08"),
      userId: user.id,
      cities: {
        create: [
          {
            name: "Lisbon",
            startDate: new Date("2026-06-05"),
            endDate: new Date("2026-06-07"),
            order: 0,
            pois: {
              create: [
                {
                  name: "Jerónimos Monastery",
                  category: "CULTURE",
                  description: "16th-century monastery in Belém.",
                  latitude: 38.6979,
                  longitude: -9.2065,
                },
                {
                  name: "Time Out Market",
                  category: "FOOD",
                  description: "Food hall with top Portuguese chefs.",
                  latitude: 38.7066,
                  longitude: -9.1463,
                },
                {
                  name: "Bairro Alto",
                  category: "NIGHTLIFE",
                  description: "Bar district that comes alive at night.",
                  latitude: 38.7137,
                  longitude: -9.1453,
                },
              ],
            },
          },
          {
            name: "Sintra",
            startDate: new Date("2026-06-07"),
            endDate: new Date("2026-06-08"),
            order: 1,
            pois: {
              create: [
                {
                  name: "Pena Palace",
                  category: "CULTURE",
                  description: "Romanticist castle on a hilltop.",
                  latitude: 38.7876,
                  longitude: -9.3905,
                },
                {
                  name: "Tascantiga",
                  category: "FOOD",
                  description: "Tapas spot in the historic center.",
                  latitude: 38.7975,
                  longitude: -9.3878,
                },
                {
                  name: "Serra de Sintra",
                  category: "OUTDOORS",
                  description: "Forested hills above the town.",
                  latitude: 38.7833,
                  longitude: -9.4167,
                },
              ],
            },
          },
        ],
      },
    },
  });

  // Generate DayPlans for every city's date range
  const cities = await prisma.city.findMany();
  for (const city of cities) {
    for (const date of eachDay(city.startDate, city.endDate)) {
      await prisma.dayPlan.create({ data: { cityId: city.id, date } });
    }
  }

  const dayCount = await prisma.dayPlan.count();
  console.log(`Seeded 2 trips, ${cities.length} cities, ${dayCount} day plans, 12 POIs.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
