import { getConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { createApp } from "./app.js";

const config = getConfig();
const db = openDatabase(config.databasePath);
const app = createApp(db);

app.listen(config.port, () => {
  console.log(`AlphaPane API listening on http://localhost:${config.port}`);
});

