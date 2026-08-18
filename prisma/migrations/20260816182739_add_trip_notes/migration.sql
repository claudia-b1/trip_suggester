-- CreateTable
CREATE TABLE "TripNote" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER,
    "cityId" INTEGER,
    "dayPlanId" INTEGER,
    "content" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripNote_tripId_idx" ON "TripNote"("tripId");

-- CreateIndex
CREATE INDEX "TripNote_cityId_idx" ON "TripNote"("cityId");

-- CreateIndex
CREATE INDEX "TripNote_dayPlanId_idx" ON "TripNote"("dayPlanId");

-- AddForeignKey
ALTER TABLE "TripNote" ADD CONSTRAINT "TripNote_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripNote" ADD CONSTRAINT "TripNote_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripNote" ADD CONSTRAINT "TripNote_dayPlanId_fkey" FOREIGN KEY ("dayPlanId") REFERENCES "DayPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
