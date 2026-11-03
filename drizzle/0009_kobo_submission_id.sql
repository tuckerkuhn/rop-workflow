ALTER TABLE "evidence" ADD COLUMN "kobo_submission_id" integer;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "kobo_removed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "evidence" SET "kobo_submission_id" = ("payload"->>'_id')::integer WHERE "source" = 'kobo' AND "payload"->>'_id' ~ '^[0-9]+$';
