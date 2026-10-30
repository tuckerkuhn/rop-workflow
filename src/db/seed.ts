/**
 * Loads the fictional demo project A-2027 into the database: farmers (names in the locked
 * farmer_pii table), plots, Field activities state and sample review-queue records.
 * Wipes the database first, so use it on development databases only. Run with `npm run db:seed`.
 */
import { seedDatabase } from "@/server/demo-seed";

seedDatabase()
  .then((r) => {
    console.log(`Seeded project ${r.project} with ${r.farmers} fictional farmers.`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
