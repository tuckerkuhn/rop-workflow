#!/usr/bin/env bash
# Sets up a throwaway copy of the app for testing: a local Postgres with fictional data only.
# Never points at Supabase. Run from the repository root:  bash docs/deep-dive/tools/setup-local.sh
set -euo pipefail
URL=postgresql://rop:rop@localhost:5432/rop

service postgresql start >/dev/null 2>&1 || true
sleep 2
su postgres -c "psql -qc \"create user rop with password 'rop' superuser\"" 2>/dev/null || true
su postgres -c "psql -qc 'drop database if exists rop'" >/dev/null
su postgres -c "psql -qc 'create database rop owner rop'" >/dev/null
# Roles Supabase provides and the migrations grant to.
psql "$URL" -qc "do \$\$ begin create role anon; exception when duplicate_object then null; end \$\$; do \$\$ begin create role authenticated; exception when duplicate_object then null; end \$\$; do \$\$ begin create role service_role; exception when duplicate_object then null; end \$\$;"

# Never overwrite a real .env.local: this file is written only when none exists or it is already the local one.
if [ ! -f .env.local ] || grep -q "localhost:5432/rop" .env.local; then
  cat > .env.local <<ENV
DATABASE_URL=$URL
DIRECT_DATABASE_URL=$URL
DEMO_SIGN_IN=1
KOBO_TOKEN_KEY=dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXRlc3Q=
ENV
else
  echo "A .env.local that is not the local test one is here. Stopping so it is not touched." >&2
  exit 1
fi

# npm ci fails on the lock file in this sandbox; install, then put the lock file back.
[ -d node_modules ] || { npm install --no-audit --no-fund >/dev/null 2>&1; git checkout package-lock.json; }

# drizzle-kit migrate hides its errors here: apply the migration files directly, in order.
for f in drizzle/0*.sql; do
  sed 's/--> statement-breakpoint//' "$f" | psql "$URL" -q -v ON_ERROR_STOP=1 -f - >/dev/null 2>/tmp/migrate.err || { echo "Migration failed: $f"; head -3 /tmp/migrate.err; exit 1; }
done
npm run db:seed 2>&1 | tail -1
echo "Ready. Start the app:  nohup npx next dev -p 3000 > /tmp/dev.log 2>&1 &"
