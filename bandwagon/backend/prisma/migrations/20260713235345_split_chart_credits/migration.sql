-- DropIndex
DROP INDEX "AlbumChartEntry_weekDate_chart_rank_key";

-- DropIndex
DROP INDEX "ChartEntry_weekDate_chart_rank_key";

-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "hiddenAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "AlbumChartEntry_weekDate_chart_rank_artistId_key" ON "AlbumChartEntry"("weekDate", "chart", "rank", "artistId");

-- CreateIndex
CREATE UNIQUE INDEX "ChartEntry_weekDate_chart_rank_artistId_key" ON "ChartEntry"("weekDate", "chart", "rank", "artistId");

