CREATE TABLE "workplan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"activity_code" text,
	"activity" text,
	"title" text NOT NULL,
	"indicator" text,
	"unit" text,
	"org" text DEFAULT '' NOT NULL,
	"targets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_date" date,
	"end_date" date,
	"remark" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_lines" ALTER COLUMN "amount" SET DATA TYPE numeric(16, 2);--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "activity_code" text;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "activity" text;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "quantity" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "unit_cost" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "spent" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "schedule" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "kind" text DEFAULT 'program' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "procure" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "sort" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "workplan_items" ADD CONSTRAINT "workplan_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workplan_items_project_code_org" ON "workplan_items" USING btree ("project_id","code","org");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_lines_project_code" ON "budget_lines" USING btree ("project_id","code");--> statement-breakpoint
ALTER TABLE "workplan_items" ENABLE ROW LEVEL SECURITY;
