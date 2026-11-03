ALTER TABLE "kobo_forms" ADD COLUMN "purpose" text DEFAULT 'data' NOT NULL;--> statement-breakpoint
-- Forms that have already sent readiness checks are readiness forms.
UPDATE "kobo_forms" SET "purpose" = 'readiness' WHERE "asset_uid" IN (SELECT DISTINCT "kobo_asset_uid" FROM "evidence" WHERE "form" = 'readiness' AND "kobo_asset_uid" IS NOT NULL);--> statement-breakpoint
-- Their submissions synced as plain data were never reviewed: send them to the review queue.
UPDATE "evidence" AS e SET "form" = 'readiness', "review_status" = 'pending', "updated_at" = now() FROM "kobo_forms" AS f WHERE f."purpose" = 'readiness' AND e."project_id" = f."project_id" AND e."kobo_asset_uid" = f."asset_uid" AND e."source" = 'kobo' AND e."form" IS NULL;
