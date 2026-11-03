ALTER TABLE "staff" ADD COLUMN "person_id" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "profile" jsonb;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_person_id_unique" UNIQUE("person_id");--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_email_unique" UNIQUE("email");