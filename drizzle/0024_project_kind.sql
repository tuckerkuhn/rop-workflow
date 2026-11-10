ALTER TABLE "projects" ADD COLUMN "kind" text DEFAULT 'real' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_kind_check" CHECK ("kind" IN ('real', 'sample', 'sandbox'));--> statement-breakpoint
-- The two fictional test projects made on 9 Nov 2026 with Tucker's approval: left out of totals, still writable.
UPDATE "projects" SET "kind" = 'sandbox' WHERE "code" IN ('SFTP-2026', 'SSOP-2027');
