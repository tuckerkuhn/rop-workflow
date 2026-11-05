ALTER TABLE "indicators" ADD COLUMN "donor_code" text;--> statement-breakpoint
ALTER TABLE "indicators" ADD COLUMN "baseline" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "indicators" ADD COLUMN "disaggregation" jsonb;--> statement-breakpoint
ALTER TABLE "indicators" ADD COLUMN "verification" text;--> statement-breakpoint
ALTER TABLE "indicators" ADD COLUMN "budget_ref" text;