-- CreateEnum
CREATE TYPE "IdProofType" AS ENUM ('PAN', 'AADHAAR', 'VOTER_ID', 'DRIVING_LICENCE', 'PASSPORT');

-- AlterTable
ALTER TABLE "seller_profiles" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT DEFAULT 'India',
ADD COLUMN     "gstNumber" TEXT,
ADD COLUMN     "idProofNumber" TEXT,
ADD COLUMN     "idProofType" "IdProofType",
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "state" TEXT;

