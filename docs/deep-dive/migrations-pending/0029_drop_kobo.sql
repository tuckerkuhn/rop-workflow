-- Part 2 step 7d: KoboToolbox removed (28 Nov 2026). WRITTEN, NOT RUN.
--
-- Kept out of drizzle/ on purpose, so no `db:migrate` runs it by accident. Tucker's standing rule
-- is no migrations; this one waits for his explicit OK and his "save". To apply it:
--   1. Move it to drizzle/0029_drop_kobo.sql and add its entry to drizzle/meta/_journal.json.
--   2. In the same change, delete koboConnections, koboForms and koboMappings and the two columns
--      below from src/db/schema.ts, and the test lines that still insert into them (search the
--      tests for koboForms, koboMappings, koboAssetUid, koboSubmissionId).
--   3. Take a database backup first (Settings, Health, Download the records).
--
-- Nothing in the app reads these tables or columns any more (branch build/kobo-out-2026-11-28,
-- commits 8cf77da and 5e23017). Two Kobo-named columns stay, because the app still uses them:
--   evidence.kobo_submission_uuid  the id a form filled in on a phone is saved under (one record,
--                                  however often it arrives); old KoboCollect records keep theirs.
--   evidence.kobo_removed_at       marks an old KoboCollect record deleted in KoboToolbox, so it
--                                  stays out of the counts.
-- Old KoboCollect records themselves stay in evidence, readable, with source 'kobo'.

DROP TABLE IF EXISTS "kobo_mappings";--> statement-breakpoint
DROP TABLE IF EXISTS "kobo_forms";--> statement-breakpoint
DROP TABLE IF EXISTS "kobo_connections";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN IF EXISTS "kobo_asset_uid";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN IF EXISTS "kobo_submission_id";
