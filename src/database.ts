import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type RealmDatabase = Database.Database;

export function openDatabase(filename: string): RealmDatabase {
  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const migrationDir = join(process.cwd(), "migrations");
  for (const name of readdirSync(migrationDir).filter((item) => item.endsWith(".sql")).sort()) {
    const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(name);
    if (applied) continue;
    const sql = readFileSync(join(migrationDir, name), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)").run(name, new Date().toISOString());
    })();
  }
  return db;
}
