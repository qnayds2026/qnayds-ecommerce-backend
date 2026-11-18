-- Enable Google OAuth accounts while preserving existing password accounts.
-- Existing users retain their password hashes; Google-only users have NULL passwordHash.
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

ALTER TABLE "users" ADD COLUMN "googleId" TEXT;

CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");
