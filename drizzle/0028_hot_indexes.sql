-- Indexes for the reads Home, the review queue and the activity log make on every visit (performance
-- survey, 24 Nov 2026). Additive only: no table or row changes. IF NOT EXISTS so a re-run is harmless.
CREATE INDEX IF NOT EXISTS "audit_log_project_action_at" ON "audit_log" USING btree ("project_id","action","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidence_project_form_status" ON "evidence" USING btree ("project_id","form","review_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_project_type_open" ON "work_items" USING btree ("project_id","type") WHERE "done_at" IS NULL;
