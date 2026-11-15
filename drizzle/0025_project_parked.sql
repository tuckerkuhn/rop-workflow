-- A real project can be parked: set aside with its data kept while the app is built (npm run park).
ALTER TABLE "projects" DROP CONSTRAINT "projects_kind_check";--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_kind_check" CHECK ("kind" IN ('real', 'sample', 'sandbox', 'parked'));
