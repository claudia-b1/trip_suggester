-- AlterTable
ALTER TABLE "FavouriteItem" ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "personalRating" INTEGER,
ADD COLUMN     "visited" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PoiRating" (
    "id" SERIAL NOT NULL,
    "poiId" INTEGER NOT NULL,
    "rating" INTEGER,
    "notInterested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoiRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PoiRating_poiId_key" ON "PoiRating"("poiId");

-- AddForeignKey
ALTER TABLE "PoiRating" ADD CONSTRAINT "PoiRating_poiId_fkey" FOREIGN KEY ("poiId") REFERENCES "Poi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
