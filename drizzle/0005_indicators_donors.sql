CREATE TYPE "public"."indicator_frequency" AS ENUM('monthly', 'quarterly', 'end_of_season');--> statement-breakpoint
CREATE TYPE "public"."indicator_level" AS ENUM('goal', 'outcome', 'output');--> statement-breakpoint
CREATE TABLE "donors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"report_format" text DEFAULT 'baseline' NOT NULL,
	"indicator_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indicators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"target" numeric(14, 2) NOT NULL,
	"level" "indicator_level" NOT NULL,
	"result" text,
	"source" text NOT NULL,
	"filter" jsonb,
	"frequency" "indicator_frequency" NOT NULL,
	"theme" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "donor_id" uuid;--> statement-breakpoint
ALTER TABLE "donors" ADD CONSTRAINT "donors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donors" ADD CONSTRAINT "donors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "indicators_project_code" ON "indicators" USING btree ("project_id","code");--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Locked like every other table (see 0002): only the app's server connection reads them.
ALTER TABLE "indicators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donors" ENABLE ROW LEVEL SECURITY;
