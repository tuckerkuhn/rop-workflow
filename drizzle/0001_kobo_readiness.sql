CREATE TYPE "public"."review_status" AS ENUM('pending', 'accepted', 'queried');--> statement-breakpoint
CREATE TABLE "farmer_pii" (
	"farmer_id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"project_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "farmers" ALTER COLUMN "full_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "form" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "farmer_code" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "review_status" "review_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "query_note" text;--> statement-breakpoint
ALTER TABLE "farmers" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "farmers" ADD COLUMN "household_head_initials" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "farmer_pii" ADD CONSTRAINT "farmer_pii_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_items" ADD CONSTRAINT "field_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_items" ADD CONSTRAINT "field_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_state" ADD CONSTRAINT "project_state_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "field_items_project_key" ON "field_items" USING btree ("project_id","item_key");--> statement-breakpoint
CREATE UNIQUE INDEX "project_state_project_key" ON "project_state" USING btree ("project_id","key");--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmers" ADD CONSTRAINT "farmers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_code_unique" UNIQUE("code");