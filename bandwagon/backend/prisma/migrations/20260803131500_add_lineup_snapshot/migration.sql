-- CreateTable
CREATE TABLE "LineupSnapshot" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "slot" TEXT NOT NULL,
    "artistId" TEXT,

    CONSTRAINT "LineupSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LineupSnapshot_leagueId_week_idx" ON "LineupSnapshot"("leagueId", "week");

-- CreateIndex
CREATE UNIQUE INDEX "LineupSnapshot_teamId_week_slot_key" ON "LineupSnapshot"("teamId", "week", "slot");

-- AddForeignKey
ALTER TABLE "LineupSnapshot" ADD CONSTRAINT "LineupSnapshot_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineupSnapshot" ADD CONSTRAINT "LineupSnapshot_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineupSnapshot" ADD CONSTRAINT "LineupSnapshot_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
