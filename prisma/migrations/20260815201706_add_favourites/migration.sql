-- CreateTable
CREATE TABLE "FavouriteList" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "parentId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FavouriteList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavouriteItem" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "country" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "photoUrl" TEXT,
    "website" TEXT,
    "sourcePlaceId" TEXT,
    "listId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FavouriteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FavouriteList_parentId_idx" ON "FavouriteList"("parentId");

-- CreateIndex
CREATE INDEX "FavouriteItem_listId_idx" ON "FavouriteItem"("listId");

-- CreateIndex
CREATE INDEX "FavouriteItem_city_idx" ON "FavouriteItem"("city");

-- AddForeignKey
ALTER TABLE "FavouriteList" ADD CONSTRAINT "FavouriteList_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FavouriteList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavouriteItem" ADD CONSTRAINT "FavouriteItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "FavouriteList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
