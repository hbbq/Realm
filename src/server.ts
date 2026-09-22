import { buildApp } from "./app.js";
import { openDatabase } from "./database.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const databasePath = process.env.REALM_DATABASE ?? "realm.sqlite";
const database = openDatabase(databasePath);
const app = buildApp(database);

const close = async () => { await app.close(); database.close(); };
process.on("SIGINT", () => void close().then(() => process.exit(0)));
process.on("SIGTERM", () => void close().then(() => process.exit(0)));

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  database.close();
  process.exit(1);
});
