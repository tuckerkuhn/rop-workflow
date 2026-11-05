CREATE TABLE "organization_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_state" ADD CONSTRAINT "organization_state_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_state_org_key" ON "organization_state" USING btree ("organization_id","key");--> statement-breakpoint
-- Like every table: closed to the public API; the app reaches it through its own server connection.
ALTER TABLE "organization_state" ENABLE ROW LEVEL SECURITY;