-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PARTICIPANT', 'ORGANISER');

-- CreateEnum
CREATE TYPE "TitleKind" AS ENUM ('RECORD', 'BADGE');

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "githubUsername" TEXT NOT NULL,
    "zid" TEXT NOT NULL,
    "githubId" INTEGER,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "accountCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cohort" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PARTICIPANT',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramRepo" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ProgramRepo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatSnapshot" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalCommits" INTEGER NOT NULL,
    "totalContributions" INTEGER NOT NULL,
    "totalPRs" INTEGER NOT NULL,
    "mergedPRs" INTEGER NOT NULL,
    "reviewsGiven" INTEGER NOT NULL,
    "issuesOpened" INTEGER NOT NULL,
    "followers" INTEGER NOT NULL,
    "totalStars" INTEGER NOT NULL,
    "repoCount" INTEGER NOT NULL,
    "contributedRepoCount" INTEGER NOT NULL,
    "languageCount" INTEGER NOT NULL,
    "topLanguages" JSONB NOT NULL,
    "longestStreak" INTEGER NOT NULL,
    "currentStreak" INTEGER NOT NULL,
    "maxCommitsInOneDay" INTEGER NOT NULL,
    "weekendCommitRatio" DOUBLE PRECISION NOT NULL,
    "nightCommitRatio" DOUBLE PRECISION,
    "calendar" JSONB NOT NULL,

    CONSTRAINT "StatSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Title" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "TitleKind" NOT NULL,
    "flavor" TEXT,

    CONSTRAINT "Title_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TitleAward" (
    "id" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "value" JSONB NOT NULL,

    CONSTRAINT "TitleAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Member_githubUsername_key" ON "Member"("githubUsername");

-- CreateIndex
CREATE UNIQUE INDEX "Member_zid_key" ON "Member"("zid");

-- CreateIndex
CREATE INDEX "Member_githubUsername_idx" ON "Member"("githubUsername");

-- CreateIndex
CREATE UNIQUE INDEX "Cohort_slug_key" ON "Cohort"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_memberId_cohortId_key" ON "Membership"("memberId", "cohortId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramRepo_membershipId_owner_name_key" ON "ProgramRepo"("membershipId", "owner", "name");

-- CreateIndex
CREATE INDEX "StatSnapshot_memberId_cohortId_capturedAt_idx" ON "StatSnapshot"("memberId", "cohortId", "capturedAt");

-- CreateIndex
CREATE INDEX "StatSnapshot_cohortId_capturedAt_idx" ON "StatSnapshot"("cohortId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Title_key_key" ON "Title"("key");

-- CreateIndex
CREATE INDEX "TitleAward_titleId_cohortId_revokedAt_idx" ON "TitleAward"("titleId", "cohortId", "revokedAt");

-- CreateIndex
CREATE INDEX "TitleAward_memberId_revokedAt_idx" ON "TitleAward"("memberId", "revokedAt");

-- CreateIndex
CREATE INDEX "TitleAward_cohortId_idx" ON "TitleAward"("cohortId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramRepo" ADD CONSTRAINT "ProgramRepo_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatSnapshot" ADD CONSTRAINT "StatSnapshot_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatSnapshot" ADD CONSTRAINT "StatSnapshot_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TitleAward" ADD CONSTRAINT "TitleAward_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TitleAward" ADD CONSTRAINT "TitleAward_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TitleAward" ADD CONSTRAINT "TitleAward_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;
