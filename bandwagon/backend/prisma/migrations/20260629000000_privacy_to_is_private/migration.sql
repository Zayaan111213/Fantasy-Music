-- Convert League.privacy (String "private"/"public") to League.isPrivate (Boolean)
ALTER TABLE "League" RENAME COLUMN "privacy" TO "isPrivate";
-- Drop the old string default before changing the type to avoid 42804 datatype mismatch
ALTER TABLE "League" ALTER COLUMN "isPrivate" DROP DEFAULT;
ALTER TABLE "League" ALTER COLUMN "isPrivate" TYPE BOOLEAN USING ("isPrivate" = 'private');
ALTER TABLE "League" ALTER COLUMN "isPrivate" SET DEFAULT true;
