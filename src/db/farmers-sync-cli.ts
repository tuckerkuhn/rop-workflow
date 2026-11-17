/**
 * Puts every farmer's row in `farmers` in step with their working record (server/farmer-mirror).
 * The app now does this on every save; this is for rows that drifted before it did.
 *
 *   npm run farmers:sync              list what would change, change nothing
 *   npm run farmers:sync -- --apply   make the changes
 */
import { farmerDrift } from "@/server/farmer-mirror";

async function main() {
  const apply = process.argv.includes("--apply");
  const drift = await farmerDrift(apply);
  for (const d of drift) console.log(`${d.code}: ${d.changes.join("; ")}`);
  console.log(drift.length ? `${drift.length} farmer row(s) ${apply ? "put right" : "differ. Run again with --apply to put them right"}.` : "Every farmer row matches its working record.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
