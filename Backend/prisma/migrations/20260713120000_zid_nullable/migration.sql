-- Open the global cohort: allow members without a zid.
-- Postgres unique indexes treat NULLs as distinct, so the existing
-- Member_zid_key unique constraint remains valid — any number of rows may
-- carry zid = NULL, but two non-NULL zids still collide.
ALTER TABLE "Member" ALTER COLUMN "zid" DROP NOT NULL;
