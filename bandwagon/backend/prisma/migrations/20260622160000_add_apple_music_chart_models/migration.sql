-- AlterTable
ALTER TABLE "Artist" DROP COLUMN "secondaryGenres",
ADD COLUMN     "appleArtistId" INTEGER;

-- CreateTable
CREATE TABLE "ChartEntry" (
    "id" TEXT NOT NULL,
    "weekDate" DATE NOT NULL,
    "chart" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "songTitle" TEXT NOT NULL,
    "appleSongId" INTEGER,
    "artistId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChartEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlbumChartEntry" (
    "id" TEXT NOT NULL,
    "weekDate" DATE NOT NULL,
    "chart" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "albumTitle" TEXT NOT NULL,
    "appleAlbumId" INTEGER,
    "artistId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlbumChartEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChartEntry_weekDate_idx" ON "ChartEntry"("weekDate");

-- CreateIndex
CREATE INDEX "ChartEntry_artistId_idx" ON "ChartEntry"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "ChartEntry_weekDate_chart_rank_key" ON "ChartEntry"("weekDate", "chart", "rank");

-- CreateIndex
CREATE INDEX "AlbumChartEntry_weekDate_idx" ON "AlbumChartEntry"("weekDate");

-- CreateIndex
CREATE INDEX "AlbumChartEntry_artistId_idx" ON "AlbumChartEntry"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "AlbumChartEntry_weekDate_chart_rank_key" ON "AlbumChartEntry"("weekDate", "chart", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_appleArtistId_key" ON "Artist"("appleArtistId");

-- AddForeignKey
ALTER TABLE "ChartEntry" ADD CONSTRAINT "ChartEntry_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumChartEntry" ADD CONSTRAINT "AlbumChartEntry_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
