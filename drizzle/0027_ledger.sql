-- The grant ledger (docs/deep-dive/09-ledger-slice-prompt.md, 09-finance.md). Additive only: new tables,
-- indexes, functions and triggers. No existing table, column or row is changed.
--
-- The database itself enforces the accounting rules, so no route, script or direct SQL can break them:
--   1. A line has a debit or a credit, never both, never negative (CHECK).
--   2. A posted entry balances in the functional currency (deferred constraint trigger, checked at commit,
--      so an entry, its lines and its posting are written in one transaction).
--   3. A posted entry and its lines are never updated or deleted. The only change an entry ever takes is
--      draft to posted. Corrections are reversals that point to the original (reverses_id).
--   4. Nothing posts into a locked period (fiscal_periods.locked_at).
--   5. The person who recorded a payment cannot post it when it is over the organization's limit for
--      posting one's own payments, read from organization_state key 'ledger' (selfPostLimit, in the
--      functional currency). The app keeps that document in step with the organization's rule
--      ledgerSelfPostMaxUsd (lib/policy). No document: limit 0, every payment needs a second person.
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"restricted" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"budget_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_type" CHECK ("type" IN ('asset', 'liability', 'net_assets', 'revenue', 'expense')),
	CONSTRAINT "ledger_accounts_budget_kind" CHECK ("budget_kind" IS NULL OR ("type" = 'expense' AND "budget_kind" IN ('program', 'personnel', 'operations'))),
	CONSTRAINT "ledger_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_org_code" ON "ledger_accounts" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_org_budget_kind" ON "ledger_accounts" USING btree ("organization_id","budget_kind") WHERE "budget_kind" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"entry_date" date NOT NULL,
	"period" date NOT NULL,
	"memo" text NOT NULL,
	"kind" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"recorded_by" text NOT NULL,
	"posted_by" text,
	"posted_at" timestamp with time zone,
	"reverses_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_kind" CHECK ("kind" IN ('payment', 'donor_receipt', 'reversal')),
	CONSTRAINT "journal_entries_status" CHECK (("status" = 'draft' AND "posted_by" IS NULL AND "posted_at" IS NULL) OR ("status" = 'posted' AND "posted_by" IS NOT NULL AND "posted_at" IS NOT NULL)),
	CONSTRAINT "journal_entries_period" CHECK ("period" = date_trunc('month', "entry_date")::date),
	CONSTRAINT "journal_entries_reversal" CHECK (("kind" = 'reversal') = ("reverses_id" IS NOT NULL)),
	CONSTRAINT "journal_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "journal_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "journal_entries_reverses_id_journal_entries_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_idempotency_key" ON "journal_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_reverses_id" ON "journal_entries" USING btree ("reverses_id") WHERE "reverses_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "journal_entries_org_period" ON "journal_entries" USING btree ("organization_id","period");--> statement-breakpoint
CREATE INDEX "journal_entries_source" ON "journal_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(16, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(16, 2) DEFAULT '0' NOT NULL,
	"currency" text NOT NULL,
	"fx_rate" numeric(18, 8) NOT NULL,
	"functional_debit" numeric(16, 2) DEFAULT '0' NOT NULL,
	"functional_credit" numeric(16, 2) DEFAULT '0' NOT NULL,
	"donor_id" uuid,
	"project_id" uuid,
	"budget_line_id" uuid,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_lines_not_negative" CHECK ("debit" >= 0 AND "credit" >= 0 AND "functional_debit" >= 0 AND "functional_credit" >= 0),
	CONSTRAINT "journal_lines_one_side" CHECK (("debit" > 0 AND "credit" = 0 AND "functional_credit" = 0) OR ("credit" > 0 AND "debit" = 0 AND "functional_debit" = 0)),
	CONSTRAINT "journal_lines_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "journal_lines_fx_rate" CHECK ("fx_rate" > 0),
	CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "journal_lines_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "journal_lines_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "journal_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "journal_lines_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "journal_lines_entry_line" ON "journal_lines" USING btree ("entry_id","line_no");--> statement-breakpoint
CREATE INDEX "journal_lines_account" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_budget_line" ON "journal_lines" USING btree ("budget_line_id");--> statement-breakpoint
CREATE INDEX "journal_lines_project" ON "journal_lines" USING btree ("project_id");--> statement-breakpoint
CREATE TABLE "fiscal_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period" date NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_periods_first_of_month" CHECK ("period" = date_trunc('month', "period")::date),
	CONSTRAINT "fiscal_periods_locked_by" CHECK ("locked_at" IS NULL OR "locked_by" IS NOT NULL),
	CONSTRAINT "fiscal_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_periods_org_period" ON "fiscal_periods" USING btree ("organization_id","period");--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ledger_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "bank_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "bank_accounts_ledger_account_id_ledger_accounts_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_ledger_account" ON "bank_accounts" USING btree ("ledger_account_id");--> statement-breakpoint
CREATE TABLE "bank_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"imported_by" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"import_key" text,
	"matched_line_id" uuid,
	CONSTRAINT "bank_statement_lines_amount" CHECK ("amount" <> 0),
	CONSTRAINT "bank_statement_lines_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "bank_statement_lines_matched_line_id_journal_lines_id_fk" FOREIGN KEY ("matched_line_id") REFERENCES "public"."journal_lines"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statement_lines_import_key" ON "bank_statement_lines" USING btree ("bank_account_id","import_key") WHERE "import_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statement_lines_matched" ON "bank_statement_lines" USING btree ("matched_line_id") WHERE "matched_line_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "bank_statement_lines_account_date" ON "bank_statement_lines" USING btree ("bank_account_id","date");--> statement-breakpoint
CREATE TABLE "reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"period" date NOT NULL,
	"statement_balance" numeric(16, 2) NOT NULL,
	"book_balance" numeric(16, 2) NOT NULL,
	"difference" numeric(16, 2) NOT NULL,
	"completed_by" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliations_first_of_month" CHECK ("period" = date_trunc('month', "period")::date),
	CONSTRAINT "reconciliations_difference" CHECK ("difference" = "statement_balance" - "book_balance"),
	CONSTRAINT "reconciliations_complete_at_zero" CHECK ("completed_at" IS NULL OR ("difference" = 0 AND "completed_by" IS NOT NULL)),
	CONSTRAINT "reconciliations_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliations_account_period" ON "reconciliations" USING btree ("bank_account_id","period");--> statement-breakpoint
-- Like every table: closed to the public API; the app reaches them through its own server connection.
ALTER TABLE "ledger_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reconciliations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The one exception to "posted is forever": resetting the fictional demo project (server/demo-seed
-- resetDemo and seedDatabase), and only through ledger_reset_demo() below. The demo project is the
-- project the app treats as demo (server/procurement-guard DEMO_PROJECT, "A-2027"). A demo
-- organization holds that project and nothing but fictional (sandbox or sample) projects: only there
-- do its locked months, reconciliations, statement lines and bank accounts go too. Where the demo
-- project shares an organization with real projects, only the demo project's own entries go. Every
-- other project's books stay refused, whatever the setting says. Deletion only: an UPDATE of a posted
-- entry or line is refused even inside the reset.
CREATE OR REPLACE FUNCTION ledger_demo_project_code() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'A-2027'::text $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION ledger_is_demo_org(org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM projects p WHERE p.organization_id = org AND p.code = ledger_demo_project_code())
     AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.organization_id = org AND p.code IS DISTINCT FROM ledger_demo_project_code() AND p.kind NOT IN ('sandbox', 'sample')
       -- A parked project (set aside, hidden everywhere) does not make the organization real, as long as it has no books.
       AND NOT (p.kind = 'parked' AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.project_id = p.id)))
$$;--> statement-breakpoint
-- The demo project ledger_reset_demo() is resetting in this very transaction, or null. The setting is
-- local to the transaction and carries its id, so one set in an earlier transaction counts for nothing.
CREATE OR REPLACE FUNCTION ledger_demo_reset_project() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v text := coalesce(current_setting('ledger.demo_reset', true), '');
BEGIN
  IF v = '' OR split_part(v, ':', 2) <> txid_current()::text THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT p.id FROM projects p WHERE p.id::text = split_part(v, ':', 1) AND p.code = ledger_demo_project_code());
END $$;--> statement-breakpoint
-- May the running demo reset remove this organization's ledger rows (periods, reconciliations, any entry)?
CREATE OR REPLACE FUNCTION ledger_demo_reset_covers_org(org uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  p uuid := ledger_demo_reset_project();
BEGIN
  RETURN p IS NOT NULL AND org IS NOT NULL
     AND EXISTS (SELECT 1 FROM projects x WHERE x.id = p AND x.organization_id = org)
     AND ledger_is_demo_org(org);
END $$;--> statement-breakpoint
-- May the running demo reset remove this posted entry (and its lines)? The demo project's own entries,
-- or any entry of a demo organization.
CREATE OR REPLACE FUNCTION ledger_demo_reset_covers(org uuid, project uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  p uuid := ledger_demo_reset_project();
BEGIN
  IF p IS NULL THEN
    RETURN false;
  END IF;
  IF project = p AND EXISTS (SELECT 1 FROM projects x WHERE x.id = p AND x.organization_id = org) THEN
    RETURN true;
  END IF;
  RETURN ledger_demo_reset_covers_org(org);
END $$;--> statement-breakpoint
-- Rules 3 and 4 for entries. An entry is always written as a draft, its lines added, and then posted
-- (server/ledger does all three in one transaction). A draft may be deleted, or posted, and nothing
-- else: posting changes status, posted_by and posted_at only, and the database stamps posted_at. A
-- posted entry never changes and is never deleted (the demo reset above excepted).
CREATE OR REPLACE FUNCTION ledger_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' AND NOT ledger_demo_reset_covers(OLD.organization_id, OLD.project_id) THEN
      RAISE EXCEPTION 'A posted entry cannot be deleted. Record a reversal instead.' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'An entry is written as a draft and posted once its lines are in.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'A posted entry cannot be changed. Record a reversal instead.' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.status <> 'posted' THEN
      RAISE EXCEPTION 'A draft entry is posted or deleted, never edited. Delete it and record it again.' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF (NEW.id, NEW.organization_id, NEW.project_id, NEW.entry_date, NEW.period, NEW.memo, NEW.kind, NEW.source_type, NEW.source_id, NEW.recorded_by, NEW.reverses_id, NEW.idempotency_key, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.project_id, OLD.entry_date, OLD.period, OLD.memo, OLD.kind, OLD.source_type, OLD.source_id, OLD.recorded_by, OLD.reverses_id, OLD.idempotency_key, OLD.created_at) THEN
      RAISE EXCEPTION 'Posting an entry changes nothing but its status.' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  IF NEW.status = 'posted' THEN
    NEW.posted_at := now();
    IF EXISTS (SELECT 1 FROM fiscal_periods p WHERE p.organization_id = NEW.organization_id AND p.period = NEW.period AND p.locked_at IS NOT NULL) THEN
      RAISE EXCEPTION 'The month of % is locked: nothing more can be posted into it. Date the entry in an open month.', to_char(NEW.period, 'FMMonth YYYY') USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.reverses_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journal_entries o WHERE o.id = NEW.reverses_id AND o.status = 'posted' AND o.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'Only a posted entry of the same organization can be reversed.' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSE
    NEW.posted_at := NULL;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER ledger_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION ledger_entry_guard();--> statement-breakpoint
-- Rule 3 for lines. Lines are added, changed or removed only while their entry is a draft. Every line's
-- account belongs to the entry's organization.
CREATE OR REPLACE FUNCTION ledger_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  e record;
  eid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    eid := OLD.entry_id;
  ELSE
    eid := NEW.entry_id;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.entry_id <> NEW.entry_id THEN
    RAISE EXCEPTION 'A line cannot move to another entry.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT status, organization_id, project_id INTO e FROM journal_entries WHERE id = eid;
  IF FOUND AND e.status = 'posted' AND NOT (TG_OP = 'DELETE' AND ledger_demo_reset_covers(e.organization_id, e.project_id)) THEN
    RAISE EXCEPTION 'The lines of a posted entry cannot be changed. Record a reversal instead.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- Either a draft's line, or the entry is gone and its lines go with it (only a draft can be deleted).
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ledger_accounts a WHERE a.id = NEW.account_id AND a.organization_id = e.organization_id) THEN
    RAISE EXCEPTION 'That account belongs to another organization.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER ledger_line_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION ledger_line_guard();--> statement-breakpoint
-- The books cannot be cleared once they hold anything posted, locked or reconciled. An empty or
-- draft-only ledger may be (the demo reset truncates organizations and projects, which cascades here).
CREATE OR REPLACE FUNCTION ledger_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_TABLE_NAME IN ('journal_entries', 'journal_lines') AND EXISTS (SELECT 1 FROM journal_entries WHERE status = 'posted'))
     OR (TG_TABLE_NAME = 'fiscal_periods' AND EXISTS (SELECT 1 FROM fiscal_periods WHERE locked_at IS NOT NULL))
     OR (TG_TABLE_NAME = 'reconciliations' AND EXISTS (SELECT 1 FROM reconciliations WHERE completed_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'The ledger cannot be cleared: it holds posted entries, locked months or completed reconciliations.';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON journal_entries FOR EACH STATEMENT EXECUTE FUNCTION ledger_no_truncate();--> statement-breakpoint
CREATE TRIGGER ledger_lines_no_truncate BEFORE TRUNCATE ON journal_lines FOR EACH STATEMENT EXECUTE FUNCTION ledger_no_truncate();--> statement-breakpoint
CREATE TRIGGER ledger_periods_no_truncate BEFORE TRUNCATE ON fiscal_periods FOR EACH STATEMENT EXECUTE FUNCTION ledger_no_truncate();--> statement-breakpoint
CREATE TRIGGER ledger_reconciliations_no_truncate BEFORE TRUNCATE ON reconciliations FOR EACH STATEMENT EXECUTE FUNCTION ledger_no_truncate();--> statement-breakpoint
-- Rules 2 and 5, checked when the transaction commits, once every line is in.
CREATE OR REPLACE FUNCTION ledger_entry_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  eid uuid;
  e record;
  n integer;
  dr numeric;
  cr numeric;
  lim numeric;
BEGIN
  IF TG_TABLE_NAME = 'journal_lines' THEN
    eid := NEW.entry_id;
  ELSE
    eid := NEW.id;
  END IF;
  SELECT * INTO e FROM journal_entries j WHERE j.id = eid;
  IF NOT FOUND OR e.status <> 'posted' THEN
    RETURN NULL;
  END IF;
  SELECT count(*), coalesce(sum(functional_debit), 0), coalesce(sum(functional_credit), 0) INTO n, dr, cr FROM journal_lines l WHERE l.entry_id = e.id;
  IF n < 2 OR dr = 0 THEN
    RAISE EXCEPTION 'A posted entry needs at least two lines and an amount.' USING ERRCODE = 'check_violation';
  END IF;
  IF dr <> cr THEN
    RAISE EXCEPTION 'The entry does not balance: debits % and credits % in the organization''s currency.', dr, cr USING ERRCODE = 'check_violation';
  END IF;
  IF e.kind IN ('payment', 'reversal') AND e.posted_by = e.recorded_by THEN
    SELECT coalesce((s.data->>'selfPostLimit')::numeric, 0) INTO lim FROM organization_state s WHERE s.organization_id = e.organization_id AND s.key = 'ledger';
    lim := coalesce(lim, 0);
    IF dr > lim THEN
      RAISE EXCEPTION 'This payment is over % in the organization''s currency, so someone other than the person who recorded it posts it.', lim USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entry_balances AFTER INSERT OR UPDATE ON journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_entry_check();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_line_balances AFTER INSERT ON journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_entry_check();--> statement-breakpoint
-- An account's organization and type never change once it has lines: that would rewrite history.
CREATE OR REPLACE FUNCTION ledger_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.organization_id, NEW.type, NEW.restricted) IS DISTINCT FROM (OLD.organization_id, OLD.type, OLD.restricted)
     AND EXISTS (SELECT 1 FROM journal_lines l WHERE l.account_id = OLD.id) THEN
    RAISE EXCEPTION 'Account % already has entries: its type and restriction cannot change. Open a new account instead.', OLD.code USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER ledger_account_guard BEFORE UPDATE ON ledger_accounts FOR EACH ROW EXECUTE FUNCTION ledger_account_guard();--> statement-breakpoint
-- A locked month stays locked.
CREATE OR REPLACE FUNCTION ledger_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL AND NOT (TG_OP = 'DELETE' AND ledger_demo_reset_covers_org(OLD.organization_id)) THEN
    RAISE EXCEPTION 'The month of % is locked and stays locked.', to_char(OLD.period, 'FMMonth YYYY') USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER ledger_period_guard BEFORE UPDATE OR DELETE ON fiscal_periods FOR EACH ROW EXECUTE FUNCTION ledger_period_guard();--> statement-breakpoint
-- A completed reconciliation is a record of what was checked: it never changes.
CREATE OR REPLACE FUNCTION ledger_reconciliation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.completed_at IS NOT NULL AND NOT (TG_OP = 'DELETE' AND ledger_demo_reset_covers_org((SELECT b.organization_id FROM bank_accounts b WHERE b.id = OLD.bank_account_id))) THEN
    RAISE EXCEPTION 'A completed reconciliation cannot be changed or deleted.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER ledger_reconciliation_guard BEFORE UPDATE OR DELETE ON reconciliations FOR EACH ROW EXECUTE FUNCTION ledger_reconciliation_guard();--> statement-breakpoint
-- The demo reset (server/demo-seed). Removes the demo's ledger rows so the demo can start again, and
-- writes one audit_log row saying what went. Refuses any project but the demo. In an organization that
-- also holds real projects it removes only the demo project's own entries, and refuses when one of them
-- is in a locked month or matched to a bank statement line (a real reconciliation depends on it).
-- SECURITY DEFINER so the triggers' exception works the same whoever calls it; closed to the public API.
CREATE OR REPLACE FUNCTION ledger_reset_demo(p_code text, p_by text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pid uuid;
  org uuid;
  whole boolean;
  n_entries integer := 0;
  n_statement integer := 0;
  n_recs integer := 0;
  n_periods integer := 0;
  n_banks integer := 0;
BEGIN
  IF p_code IS DISTINCT FROM ledger_demo_project_code() THEN
    RAISE EXCEPTION '% is a real project: its books cannot be reset.', coalesce(p_code, 'That') USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF coalesce(btrim(p_by), '') = '' THEN
    RAISE EXCEPTION 'Say who resets the demo.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT id, organization_id INTO pid, org FROM projects WHERE code = p_code;
  IF pid IS NULL THEN
    RETURN jsonb_build_object('entries', 0, 'whole', false);
  END IF;
  whole := ledger_is_demo_org(org);
  IF NOT whole THEN
    IF EXISTS (SELECT 1 FROM journal_entries e JOIN fiscal_periods f ON f.organization_id = e.organization_id AND f.period = e.period AND f.locked_at IS NOT NULL WHERE e.project_id = pid AND e.status = 'posted') THEN
      RAISE EXCEPTION 'The demo project has entries in a locked month of an organization with real projects: they stay, and the demo cannot be reset.' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM bank_statement_lines b JOIN journal_lines l ON l.id = b.matched_line_id JOIN journal_entries e ON e.id = l.entry_id WHERE e.project_id = pid) THEN
      RAISE EXCEPTION 'The demo project has entries matched to a bank statement of an organization with real projects: they stay, and the demo cannot be reset.' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  PERFORM set_config('ledger.demo_reset', pid::text || ':' || txid_current()::text, true);
  IF whole THEN
    DELETE FROM bank_statement_lines WHERE bank_account_id IN (SELECT id FROM bank_accounts WHERE organization_id = org);
    GET DIAGNOSTICS n_statement = ROW_COUNT;
    DELETE FROM reconciliations WHERE bank_account_id IN (SELECT id FROM bank_accounts WHERE organization_id = org);
    GET DIAGNOSTICS n_recs = ROW_COUNT;
    DELETE FROM journal_entries WHERE organization_id = org;
    GET DIAGNOSTICS n_entries = ROW_COUNT;
    DELETE FROM fiscal_periods WHERE organization_id = org;
    GET DIAGNOSTICS n_periods = ROW_COUNT;
    DELETE FROM bank_accounts WHERE organization_id = org;
    GET DIAGNOSTICS n_banks = ROW_COUNT;
  ELSE
    DELETE FROM journal_entries WHERE project_id = pid AND organization_id = org;
    GET DIAGNOSTICS n_entries = ROW_COUNT;
  END IF;
  PERFORM set_config('ledger.demo_reset', '', true);
  INSERT INTO audit_log (project_id, entity, entity_id, action, detail)
  VALUES (pid, 'journal_entry', pid, 'ledger_demo_reset', jsonb_build_object('by', p_by, 'organizationId', org, 'wholeOrganization', whole, 'entries', n_entries, 'statementLines', n_statement, 'reconciliations', n_recs, 'periods', n_periods, 'bankAccounts', n_banks));
  RETURN jsonb_build_object('entries', n_entries, 'whole', whole, 'statementLines', n_statement, 'reconciliations', n_recs, 'periods', n_periods, 'bankAccounts', n_banks);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION ledger_reset_demo(text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION ledger_reset_demo(text, text) FROM anon, authenticated;
