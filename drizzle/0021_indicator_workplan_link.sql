ALTER TABLE "indicators" ADD COLUMN "workplan_code" text;--> statement-breakpoint
ALTER TABLE "indicators" ADD COLUMN "in_quarterly_report" boolean DEFAULT true NOT NULL;