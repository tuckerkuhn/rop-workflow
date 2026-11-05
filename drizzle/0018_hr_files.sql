CREATE TABLE "hr_files" (
	"hash" text NOT NULL,
	"book" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_files_book_hash_pk" PRIMARY KEY("book","hash"),
	CONSTRAINT "hr_files_size" CHECK ("hr_files"."size" > 0 AND "hr_files"."size" <= 5000000)
);
--> statement-breakpoint
ALTER TABLE "hr_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Each file's key must be the SHA-256 of its bytes, so a stored receipt can never be swapped.
CREATE OR REPLACE FUNCTION hr_files_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.hash <> encode(sha256(NEW.data), 'hex') THEN RAISE EXCEPTION 'File fingerprint does not match its contents.'; END IF;
  NEW.size := octet_length(NEW.data);
  NEW.at := clock_timestamp();
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER hr_files_check BEFORE INSERT ON hr_files FOR EACH ROW EXECUTE FUNCTION hr_files_check();--> statement-breakpoint
CREATE OR REPLACE FUNCTION hr_files_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.book LIKE 'demo%' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'HR files cannot be changed or deleted.';
END $$;--> statement-breakpoint
CREATE TRIGGER hr_files_locked BEFORE UPDATE OR DELETE ON hr_files FOR EACH ROW EXECUTE FUNCTION hr_files_locked();--> statement-breakpoint
CREATE OR REPLACE FUNCTION hr_files_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'HR files cannot be cleared.';
END $$;--> statement-breakpoint
CREATE TRIGGER hr_files_no_truncate BEFORE TRUNCATE ON hr_files FOR EACH STATEMENT EXECUTE FUNCTION hr_files_no_truncate();
