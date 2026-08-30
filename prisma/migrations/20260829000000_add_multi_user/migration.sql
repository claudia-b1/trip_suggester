-- CreateTable: User
CREATE TABLE IF NOT EXISTS "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3B82F6',
    "avatar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- Create default user so existing data can be assigned
INSERT INTO "User" ("name", "color", "updatedAt")
SELECT 'Me', '#3B82F6', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "User" LIMIT 1);

-- Add userId to Trip
ALTER TABLE "Trip" ADD COLUMN IF NOT EXISTS "userId" INTEGER;
UPDATE "Trip" SET "userId" = (SELECT "id" FROM "User" ORDER BY "id" LIMIT 1) WHERE "userId" IS NULL;
ALTER TABLE "Trip" ALTER COLUMN "userId" SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE "Trip" ADD CONSTRAINT "Trip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "Trip_userId_idx" ON "Trip"("userId");

-- Add userId to FavouriteList
ALTER TABLE "FavouriteList" ADD COLUMN IF NOT EXISTS "userId" INTEGER;
UPDATE "FavouriteList" SET "userId" = (SELECT "id" FROM "User" ORDER BY "id" LIMIT 1) WHERE "userId" IS NULL;
ALTER TABLE "FavouriteList" ALTER COLUMN "userId" SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE "FavouriteList" ADD CONSTRAINT "FavouriteList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "FavouriteList_userId_idx" ON "FavouriteList"("userId");

-- Add userId to PoiRating + change unique constraint
ALTER TABLE "PoiRating" ADD COLUMN IF NOT EXISTS "userId" INTEGER;
UPDATE "PoiRating" SET "userId" = (SELECT "id" FROM "User" ORDER BY "id" LIMIT 1) WHERE "userId" IS NULL;
ALTER TABLE "PoiRating" ALTER COLUMN "userId" SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE "PoiRating" ADD CONSTRAINT "PoiRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Drop old unique index on poiId alone, add compound unique
DROP INDEX IF EXISTS "PoiRating_poiId_key";
DO $$ BEGIN
  ALTER TABLE "PoiRating" ADD CONSTRAINT "PoiRating_poiId_userId_key" UNIQUE ("poiId", "userId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
