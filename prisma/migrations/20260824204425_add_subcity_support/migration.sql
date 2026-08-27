-- AlterTable
ALTER TABLE "City" ADD COLUMN     "parentCityId" INTEGER;

-- CreateIndex
CREATE INDEX "City_parentCityId_idx" ON "City"("parentCityId");

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_parentCityId_fkey" FOREIGN KEY ("parentCityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
