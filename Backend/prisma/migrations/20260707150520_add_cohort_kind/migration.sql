-- CreateEnum
CREATE TYPE "CohortKind" AS ENUM ('PROGRAM', 'GLOBAL');

-- AlterTable
ALTER TABLE "Cohort" ADD COLUMN     "kind" "CohortKind" NOT NULL DEFAULT 'PROGRAM';
