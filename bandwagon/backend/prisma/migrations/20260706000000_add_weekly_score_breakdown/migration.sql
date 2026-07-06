-- Per-signal breakdown on WeeklyScore, so past weeks can show why an artist
-- scored what they did (song/album rank + title + position/movement points).
ALTER TABLE "WeeklyScore" ADD COLUMN "songRank" INTEGER;
ALTER TABLE "WeeklyScore" ADD COLUMN "songTitle" TEXT;
ALTER TABLE "WeeklyScore" ADD COLUMN "songPositionPoints" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "WeeklyScore" ADD COLUMN "songMovement" INTEGER;
ALTER TABLE "WeeklyScore" ADD COLUMN "songMovementPoints" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "WeeklyScore" ADD COLUMN "songIsDebut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WeeklyScore" ADD COLUMN "albumRank" INTEGER;
ALTER TABLE "WeeklyScore" ADD COLUMN "albumTitle" TEXT;
ALTER TABLE "WeeklyScore" ADD COLUMN "albumPositionPoints" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "WeeklyScore" ADD COLUMN "albumMovement" INTEGER;
ALTER TABLE "WeeklyScore" ADD COLUMN "albumMovementPoints" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "WeeklyScore" ADD COLUMN "albumIsDebut" BOOLEAN NOT NULL DEFAULT false;
