CREATE TABLE "hr_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book" text NOT NULL,
	"n" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text,
	"data" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "hr_ledger_book_n" ON "hr_ledger" USING btree ("book","n");--> statement-breakpoint
ALTER TABLE "hr_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The database, not the app, numbers, timestamps and seals each entry. One writer per book at a time.
CREATE OR REPLACE FUNCTION hr_ledger_seal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  last_n integer;
  last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('hr_ledger:' || NEW.book));
  SELECT l.n, l.hash INTO last_n, last_hash FROM hr_ledger l WHERE l.book = NEW.book ORDER BY l.n DESC LIMIT 1;
  NEW.n := coalesce(last_n, 0) + 1;
  NEW.at := clock_timestamp();
  NEW.prev_hash := coalesce(last_hash, 'genesis');
  NEW.hash := encode(sha256(convert_to(concat_ws('|',
    NEW.prev_hash, NEW.book, NEW.n::text,
    to_char(NEW.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    NEW.actor, NEW.kind, coalesce(NEW.subject, ''), NEW.data::text), 'UTF8')), 'hex');
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER hr_ledger_seal BEFORE INSERT ON hr_ledger FOR EACH ROW EXECUTE FUNCTION hr_ledger_seal();--> statement-breakpoint
-- Entries are never changed. Only sample books (names starting "demo") may be cleared.
CREATE OR REPLACE FUNCTION hr_ledger_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.book LIKE 'demo%' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'HR records cannot be changed or deleted (entry % of book %).', OLD.n, OLD.book;
END $$;--> statement-breakpoint
CREATE TRIGGER hr_ledger_locked BEFORE UPDATE OR DELETE ON hr_ledger FOR EACH ROW EXECUTE FUNCTION hr_ledger_locked();--> statement-breakpoint
CREATE OR REPLACE FUNCTION hr_ledger_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'HR records cannot be cleared.';
END $$;--> statement-breakpoint
CREATE TRIGGER hr_ledger_no_truncate BEFORE TRUNCATE ON hr_ledger FOR EACH STATEMENT EXECUTE FUNCTION hr_ledger_no_truncate();
