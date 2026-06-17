import { getConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { refreshFinancials, refreshPrices } from "./refresh.js";
import { backfillFallbacksFromCache } from "./repository.js";

const command = process.argv[2];
const db = openDatabase(getConfig().databasePath);

if (command === "refresh:financials") {
  await refreshFinancials(db);
  console.log("Financial refresh complete.");
} else if (command === "refresh:prices") {
  await refreshPrices(db);
  console.log("Price refresh complete.");
} else if (command === "backfill:fallbacks") {
  backfillFallbacksFromCache(db);
  console.log("Cache fallback backfill complete.");
} else {
  console.error("Usage: tsx src/cli.ts <refresh:financials|refresh:prices|backfill:fallbacks>");
  process.exitCode = 1;
}

