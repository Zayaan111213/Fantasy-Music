-- AlterTable
ALTER TABLE "Matchup" ADD COLUMN     "matchupType" TEXT NOT NULL DEFAULT 'regular',
ADD COLUMN     "homeSeed" INTEGER,
ADD COLUMN     "awaySeed" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Matchup_leagueId_week_homeTeamId_key" ON "Matchup"("leagueId", "week", "homeTeamId");
