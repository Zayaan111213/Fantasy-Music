-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "leagueId" TEXT;

-- CreateTable
CREATE TABLE "LeagueEvent" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeagueEvent_leagueId_createdAt_idx" ON "LeagueEvent"("leagueId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_leagueId_idx" ON "Notification"("userId", "leagueId");

-- AddForeignKey
ALTER TABLE "LeagueEvent" ADD CONSTRAINT "LeagueEvent_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
