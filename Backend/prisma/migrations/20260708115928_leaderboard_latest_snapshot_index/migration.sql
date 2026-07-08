-- CreateIndex
CREATE INDEX "StatSnapshot_cohortId_memberId_capturedAt_idx" ON "StatSnapshot"("cohortId", "memberId", "capturedAt" DESC);
