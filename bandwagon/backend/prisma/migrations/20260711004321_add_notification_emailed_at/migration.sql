-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailedAt" TIMESTAMP(3);

-- Retire all pre-existing notifications so the email dispatcher's first run
-- after deploy never sends a flood of stale emails.
UPDATE "Notification" SET "emailedAt" = CURRENT_TIMESTAMP;
