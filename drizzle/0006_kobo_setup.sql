CREATE TABLE "kobo_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"server_url" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"token_hint" text NOT NULL,
	"count_only" text DEFAULT 'all' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"connected_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kobo_connections_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "kobo_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"asset_uid" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kobo_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"indicator_id" uuid NOT NULL,
	"asset_uid" text NOT NULL,
	"question" text NOT NULL,
	"method" text NOT NULL,
	"value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kobo_mappings_indicator_id_unique" UNIQUE("indicator_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "crop" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "goal" text;--> statement-breakpoint
ALTER TABLE "kobo_connections" ADD CONSTRAINT "kobo_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_forms" ADD CONSTRAINT "kobo_forms_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_mappings" ADD CONSTRAINT "kobo_mappings_indicator_id_indicators_id_fk" FOREIGN KEY ("indicator_id") REFERENCES "public"."indicators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kobo_forms_project_asset" ON "kobo_forms" USING btree ("project_id","asset_uid");--> statement-breakpoint
-- Locked like every other table (see 0002): only the app's server connection reads them.
ALTER TABLE "kobo_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kobo_forms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kobo_mappings" ENABLE ROW LEVEL SECURITY;
