ALTER TABLE "kobo_connections" ADD COLUMN "hook_secret_hash" text;--> statement-breakpoint
ALTER TABLE "kobo_connections" ADD COLUMN "hook_enabled_at" timestamp with time zone;