-- RenameColumn (preserves existing data, unlike a generated DROP+ADD)
ALTER TABLE "User" RENAME COLUMN "displayName" TO "username";

-- AlterColumn (allow null for onboarding-incomplete accounts)
ALTER TABLE "User" ALTER COLUMN "username" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
