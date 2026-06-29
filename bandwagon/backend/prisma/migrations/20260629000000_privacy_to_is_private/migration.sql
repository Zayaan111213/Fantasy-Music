-- Convert League.privacy (String "private"/"public") to League.isPrivate (Boolean)
ALTER TABLE "League" RENAME COLUMN "privacy" TO "isPrivate";
ALTER TABLE "League" ALTER COLUMN "isPrivate" TYPE BOOLEAN USING ("isPrivate" = 'private');
ALTER TABLE "League" ALTER COLUMN "isPrivate" SET DEFAULT true;
