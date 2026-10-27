CREATE TYPE "public"."action_status" AS ENUM('open', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('training', 'land_preparation', 'readiness_check', 'input_distribution', 'planting', 'field_visit', 'harvest', 'other');--> statement-breakpoint
CREATE TYPE "public"."correction_status" AS ENUM('open', 'resolved', 'unresolved_removed');--> statement-breakpoint
CREATE TYPE "public"."dev_logic_level" AS ENUM('need', 'activity', 'output', 'outcome');--> statement-breakpoint
CREATE TYPE "public"."evidence_source" AS ENUM('kobo', 'paper', 'upload', 'manual');--> statement-breakpoint
CREATE TYPE "public"."farmer_status" AS ENUM('applicant', 'selected', 'enrolled', 'removed');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('draft', 'validated', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'project_manager', 'extension_agent', 'mel_officer', 'viewer');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"type" "activity_type" NOT NULL,
	"title" text NOT NULL,
	"dev_logic_node_id" uuid,
	"budget_line_id" uuid,
	"owner_id" uuid,
	"planned_start" date,
	"planned_end" date,
	"completed_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"actor_id" uuid,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"sequence" integer GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1)
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2),
	"currency" text DEFAULT 'USD' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"readiness_check_id" uuid NOT NULL,
	"required_action" text NOT NULL,
	"deadline" date NOT NULL,
	"communicated_by_id" uuid,
	"status" "correction_status" DEFAULT 'open' NOT NULL,
	"removal_confirmed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"variety" text
);
--> statement-breakpoint
CREATE TABLE "dev_logic_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"level" "dev_logic_level" NOT NULL,
	"statement" text NOT NULL,
	"indicator" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source" "evidence_source" NOT NULL,
	"kobo_asset_uid" text,
	"kobo_submission_uuid" text,
	"completed_by" text,
	"completed_at" timestamp with time zone,
	"location" text,
	"original_stored_at" text,
	"file_url" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_kobo_submission_uuid_unique" UNIQUE("kobo_submission_uuid")
);
--> statement-breakpoint
CREATE TABLE "expenditures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_line_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"spent_on" date NOT NULL,
	"evidence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farmers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"village" text,
	"status" "farmer_status" DEFAULT 'applicant' NOT NULL,
	"contribution_paid" boolean DEFAULT false NOT NULL,
	"contribution_paid_on" date,
	"enrolled_on" date,
	"baseline_completed_on" date,
	"removed_on" date,
	"removal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "farmers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "field_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plot_id" uuid NOT NULL,
	"activity_id" uuid,
	"visit_date" date NOT NULL,
	"visit_type" text NOT NULL,
	"visited_by_id" uuid,
	"measures" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issues" text,
	"evidence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "input_distributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plot_id" uuid NOT NULL,
	"readiness_check_id" uuid NOT NULL,
	"activity_id" uuid,
	"distributed_on" date NOT NULL,
	"recorded_by_id" uuid,
	"items" jsonb NOT NULL,
	"expenditure_id" uuid,
	"evidence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "management_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid,
	"title" text NOT NULL,
	"owner_id" uuid,
	"due_date" date,
	"status" "action_status" DEFAULT 'open' NOT NULL,
	"applies_to_season_id" uuid,
	"replaces" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mel_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"dev_logic_node_id" uuid,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"status" "finding_status" DEFAULT 'draft' NOT NULL,
	"ai_assisted" boolean DEFAULT false NOT NULL,
	"validated_by_id" uuid,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farmer_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"crop_id" uuid NOT NULL,
	"code" text NOT NULL,
	"area_ha" numeric(8, 3),
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plots_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"role" "role" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"donor" text,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readiness_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plot_id" uuid NOT NULL,
	"correction_id" uuid,
	"visit_date" date NOT NULL,
	"extension_agent_id" uuid,
	"mel_officer_id" uuid,
	"ready" boolean NOT NULL,
	"issue" text,
	"evidence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"mel_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"auth_user_id" uuid,
	"full_name" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
CREATE TABLE "training_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"farmer_id" uuid NOT NULL,
	"attended" boolean NOT NULL,
	"evidence_id" uuid
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_dev_logic_node_id_dev_logic_nodes_id_fk" FOREIGN KEY ("dev_logic_node_id") REFERENCES "public"."dev_logic_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_owner_id_staff_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_staff_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_readiness_check_id_readiness_checks_id_fk" FOREIGN KEY ("readiness_check_id") REFERENCES "public"."readiness_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_communicated_by_id_staff_id_fk" FOREIGN KEY ("communicated_by_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_removal_confirmed_by_id_staff_id_fk" FOREIGN KEY ("removal_confirmed_by_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_logic_nodes" ADD CONSTRAINT "dev_logic_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditures" ADD CONSTRAINT "expenditures_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditures" ADD CONSTRAINT "expenditures_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmers" ADD CONSTRAINT "farmers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_visits" ADD CONSTRAINT "field_visits_plot_id_plots_id_fk" FOREIGN KEY ("plot_id") REFERENCES "public"."plots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_visits" ADD CONSTRAINT "field_visits_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_visits" ADD CONSTRAINT "field_visits_visited_by_id_staff_id_fk" FOREIGN KEY ("visited_by_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_visits" ADD CONSTRAINT "field_visits_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_sources" ADD CONSTRAINT "finding_sources_finding_id_mel_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."mel_findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_sources" ADD CONSTRAINT "finding_sources_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_distributions" ADD CONSTRAINT "input_distributions_plot_id_plots_id_fk" FOREIGN KEY ("plot_id") REFERENCES "public"."plots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_distributions" ADD CONSTRAINT "input_distributions_readiness_check_id_readiness_checks_id_fk" FOREIGN KEY ("readiness_check_id") REFERENCES "public"."readiness_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_distributions" ADD CONSTRAINT "input_distributions_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_distributions" ADD CONSTRAINT "input_distributions_recorded_by_id_staff_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_distributions" ADD CONSTRAINT "input_distributions_expenditure_id_expenditures_id_fk" FOREIGN KEY ("expenditure_id") REFERENCES "public"."expenditures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_distributions" ADD CONSTRAINT "input_distributions_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_actions" ADD CONSTRAINT "management_actions_finding_id_mel_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."mel_findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_actions" ADD CONSTRAINT "management_actions_owner_id_staff_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_actions" ADD CONSTRAINT "management_actions_applies_to_season_id_seasons_id_fk" FOREIGN KEY ("applies_to_season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mel_findings" ADD CONSTRAINT "mel_findings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mel_findings" ADD CONSTRAINT "mel_findings_dev_logic_node_id_dev_logic_nodes_id_fk" FOREIGN KEY ("dev_logic_node_id") REFERENCES "public"."dev_logic_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mel_findings" ADD CONSTRAINT "mel_findings_validated_by_id_staff_id_fk" FOREIGN KEY ("validated_by_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plots" ADD CONSTRAINT "plots_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plots" ADD CONSTRAINT "plots_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plots" ADD CONSTRAINT "plots_crop_id_crops_id_fk" FOREIGN KEY ("crop_id") REFERENCES "public"."crops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_checks" ADD CONSTRAINT "readiness_checks_plot_id_plots_id_fk" FOREIGN KEY ("plot_id") REFERENCES "public"."plots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_checks" ADD CONSTRAINT "readiness_checks_extension_agent_id_staff_id_fk" FOREIGN KEY ("extension_agent_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_checks" ADD CONSTRAINT "readiness_checks_mel_officer_id_staff_id_fk" FOREIGN KEY ("mel_officer_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_checks" ADD CONSTRAINT "readiness_checks_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_attendance" ADD CONSTRAINT "training_attendance_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_attendance" ADD CONSTRAINT "training_attendance_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_attendance" ADD CONSTRAINT "training_attendance_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_unique" ON "project_members" USING btree ("project_id","staff_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "training_attendance_unique" ON "training_attendance" USING btree ("activity_id","farmer_id");