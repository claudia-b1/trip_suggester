-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "coverImage" TEXT;
