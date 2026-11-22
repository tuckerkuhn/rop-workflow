-- Premium free trial: the organization has the paid plan's features until this moment (lib/plans effectivePlan).
ALTER TABLE "organizations" ADD COLUMN "trial_ends_at" timestamp with time zone;
