-- WeeklyScore is a pure cache of chart-derived scores; wipe and rekey by
-- calendar weekDate. Rebuilt by src/jobs/repairLeagueWeeks.ts (and the
-- daily pipeline keeps the current week fresh).
DELETE FROM "WeeklyScore";
-- DropIndex
DROP INDEX "WeeklyScore_artistId_week_seasonYear_key";

-- AlterTable
ALTER TABLE "WeeklyScore" DROP COLUMN "seasonYear",
DROP COLUMN "week",
ADD COLUMN     "weekDate" DATE NOT NULL;

-- CreateIndex
CREATE INDEX "WeeklyScore_weekDate_idx" ON "WeeklyScore"("weekDate");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyScore_artistId_weekDate_key" ON "WeeklyScore"("artistId", "weekDate");

