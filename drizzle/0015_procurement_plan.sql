CREATE TABLE "procurement_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"plan_key" text NOT NULL,
	"budget_line_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"start_by" date NOT NULL,
	"tech_lead" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "procurement_plan" ADD CONSTRAINT "procurement_plan_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_plan" ADD CONSTRAINT "procurement_plan_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "procurement_plan_project_key" ON "procurement_plan" USING btree ("project_id","plan_key");--> statement-breakpoint
ALTER TABLE "procurement_plan" ENABLE ROW LEVEL SECURITY;
