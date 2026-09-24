import { buildApp } from "./app.js";
import { openDatabase } from "./database.js";
import { IllustrationService, openAiIllustrator, openAiImageGenerator } from "./illustrations.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const databasePath = process.env.REALM_DATABASE ?? "realm.sqlite";
const database = openDatabase(databasePath);
const app = buildApp(database);
const apiKey = process.env.OPENAI_API_KEY;
let stopped = false;
let timer: NodeJS.Timeout | undefined;
let running: Promise<void> = Promise.resolve();
if (process.env.REALM_ILLUSTRATIONS_ENABLED === "true" && apiKey) {
  const worker = new IllustrationService(database, process.env.REALM_ILLUSTRATION_DIR ?? "illustrations",
    openAiIllustrator(apiKey), openAiImageGenerator(apiKey));
  const tick = () => {
    running = worker.processOne().then((worked) => {
      if (!stopped) timer = setTimeout(tick, worked ? 1000 : 10_000);
    }).catch((error) => {
      app.log.error(error);
      if (!stopped) timer = setTimeout(tick, 10_000);
    });
  };
  timer = setTimeout(tick, 1000);
}

const close = async () => { stopped = true; if (timer) clearTimeout(timer); await running; await app.close(); database.close(); };
process.on("SIGINT", () => void close().then(() => process.exit(0)));
process.on("SIGTERM", () => void close().then(() => process.exit(0)));

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  database.close();
  process.exit(1);
});
