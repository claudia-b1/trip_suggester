-- DropIndex
DROP INDEX IF EXISTS "CityInfoCache_cityId_key";

-- AlterTable
ALTER TABLE "CityInfoCache" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'city-info';

-- CreateIndex
CREATE UNIQUE INDEX "CityInfoCache_cityId_type_key" ON "CityInfoCache"("cityId", "type");
