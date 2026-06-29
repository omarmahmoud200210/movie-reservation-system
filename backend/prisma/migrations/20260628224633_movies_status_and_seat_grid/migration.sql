-- CreateEnum
CREATE TYPE "MovieStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- DropIndex
DROP INDEX "screening_screenDate_idx";

-- AlterTable
ALTER TABLE "movie" ADD COLUMN     "status" "MovieStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "reservation" DROP COLUMN "held_until",
ADD COLUMN     "heldUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "screening" DROP COLUMN "screenDate",
DROP COLUMN "screenTime",
ADD COLUMN     "startTime" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "seat" ADD COLUMN     "number" TEXT NOT NULL,
ADD COLUMN     "row" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "screening_startTime_idx" ON "screening"("startTime");

-- CreateIndex
CREATE INDEX "seat_hallId_idx" ON "seat"("hallId");

-- CreateIndex
CREATE UNIQUE INDEX "seat_hallId_row_number_key" ON "seat"("hallId", "row", "number");
