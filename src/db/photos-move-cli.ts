/**
 * Moves the proof photos already inside the records into file storage (server/photo-move), once
 * PROOF_FILE_STORE=supabase is set. Each photo keeps its fingerprint.
 *
 *   npm run photos:move              count what would move, change nothing
 *   npm run photos:move -- --apply   move them
 */
import { movePhotos } from "@/server/photo-move";

async function main() {
  const apply = process.argv.includes("--apply");
  const r = await movePhotos(apply);
  const mb = (r.bytes / 1_000_000).toFixed(1);
  console.log(`${r.farmerPhotos} farmer photo(s) and ${r.formPhotos} form photo(s) on ${r.records} record(s), about ${mb} MB. ${apply ? "Moved to file storage." : "Run again with --apply to move them."}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
