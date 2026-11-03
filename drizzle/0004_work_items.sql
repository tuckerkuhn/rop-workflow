CREATE TYPE "public"."milestone_kind" AS ENUM('report_deadline', 'harvest_window', 'field_activity', 'other');--> statement-breakpoint
CREATE TYPE "public"."work_item_type" AS ENUM('task', 'milestone');--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"project_id" uuid NOT NULL,
	"type" "work_item_type" NOT NULL,
	"title" text NOT NULL,
	"date" date,
	"end_date" date,
	"milestone_kind" "milestone_kind",
	"assignee" text,
	"done_at" timestamp with time zone,
	"done_by" text,
	"created_by" text,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_items_shape" CHECK (("work_items"."type" = 'task' AND "work_items"."milestone_kind" IS NULL AND "work_items"."end_date" IS NULL)
        OR ("work_items"."type" = 'milestone' AND "work_items"."milestone_kind" IS NOT NULL AND "work_items"."date" IS NOT NULL AND "work_items"."done_at" IS NULL
            AND ("work_items"."end_date" IS NULL OR "work_items"."end_date" >= "work_items"."date")))
);
--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_items_project_source" ON "work_items" USING btree ("project_id","source_key");--> statement-breakpoint
-- Locked like every other table (see 0002): only the app's server connection reads it.
ALTER TABLE "work_items" ENABLE ROW LEVEL SECURITY;
