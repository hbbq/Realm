import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/database.js";
import { buildApp } from "../src/app.js";
import { IllustrationService } from "../src/illustrations.js";

test("illustrations use safe name fallback, remain revisionless, and require actor visibility", async () => {
  const dir = mkdtempSync(join(tmpdir(), "realm-illustration-"));
  const db = openDatabase(join(dir, "realm.sqlite"));
  const app = buildApp(db, join(dir, "assets"));
  try {
    const game = (await app.inject({ method: "POST", url: "/games", payload: { title: "Test", definition: {
      illustration: { style: "Ink drawing", policy: "Illustrate notable places" }
    } } })).json().id as string;
    const patch = await app.inject({ method: "POST", url: `/games/${game}/world-patches`, payload: {
      expected_revision: 0, idempotency_key: "seed", entities: [
        { id: "actor", kind: "creature", name: "Secret actor" },
        { id: "other", kind: "creature", name: "Other actor" },
        { id: "place", kind: "place", name: "Secret real name", description: "Hidden treasure", appearance: "A moss-covered stone tower", player: {
          name: "Visible place", description: "A stone tower" }, player_visible: true },
        { id: "hidden", kind: "item", name: "Hidden object", description: "Do not reveal",
          properties: { secret: "Buried gold" } },
        { id: "concealed", kind: "item", name: "Secret object", player: { name: "A brass key" } }
      ], facts: [{ text: "Hidden murderer", subject_entity_id: "place" }]
    } });
    assert.equal(patch.statusCode, 201);
    const eventsBefore = db.prepare("SELECT count(*) AS count FROM events WHERE game_id=?").get(game) as { count: number };
    const contexts: Record<string, unknown>[] = [];
    const worker = new IllustrationService(db, join(dir, "assets"), async (context) => {
      contexts.push(context);
      return { action: "illustrate", image_prompt: "A stone tower" };
    }, async () => Buffer.from("89504e470d0a1a0a", "hex"));
    for (let i = 0; i < 5; i++) assert.equal(await worker.processOne(), true);
    assert.equal(await worker.processOne(), false);
    assert.equal(contexts.length, 5);
    const names = contexts.map((context: any) => context.entity.name);
    assert.ok(names.includes("Visible place"));
    assert.ok(names.includes("Hidden object"));
    assert.ok(names.includes("A brass key"));
    const hiddenContext = contexts.find((context: any) => context.entity.name === "Hidden object") as any;
    assert.equal(hiddenContext.entity.appearance, null);
    assert.equal("description" in hiddenContext.entity, false);
    assert.equal("properties" in hiddenContext.entity, false);
    const placeContext = contexts.find((context: any) => context.entity.name === "Visible place") as any;
    assert.equal(placeContext.entity.kind, "place");
    assert.equal(placeContext.entity.appearance, "A moss-covered stone tower");
    assert.doesNotMatch(JSON.stringify(contexts), /Hidden treasure|Hidden murderer|Secret real name|Do not reveal|Buried gold|Secret object|A stone tower/);
    const state = (await app.inject({ method: "GET", url: `/games/${game}/state?actor_id=actor` })).json();
    assert.equal(state.entities.some((e: any) => e.id === "hidden"), false);
    const place = state.entities.find((e: any) => e.id === "place");
    assert.equal(place.illustration.status, "illustrated");
    const asset = await app.inject({ method: "GET", url: place.illustration.url });
    assert.equal(asset.statusCode, 200);
    assert.deepEqual(asset.rawPayload, Buffer.from("89504e470d0a1a0a", "hex"));
    const hidden = await app.inject({ method: "GET", url: `/games/${game}/entities/hidden/illustration?actor_id=actor` });
    assert.equal(hidden.statusCode, 404);
    const authoritative = (await app.inject({ method: "GET", url: `/games/${game}/authoritative-state` })).json();
    assert.equal(authoritative.game.current_revision, 1);
    const authoritativeHidden = authoritative.entities.find((e: any) => e.id === "hidden");
    assert.equal(authoritativeHidden.illustration.status, "illustrated");
    assert.ok(authoritativeHidden.illustration.url);
    assert.equal((await app.inject({ method: "GET", url: authoritativeHidden.illustration.url })).statusCode, 200);
    const authoritativePlace = authoritative.entities.find((e: any) => e.id === "place");
    assert.equal(authoritativePlace.appearance, "A moss-covered stone tower");
    assert.equal(place.appearance, undefined);
    assert.equal(authoritativePlace.illustration.status, "illustrated");
    assert.ok(authoritativePlace.illustration.url);
    assert.equal(authoritativePlace.illustration.url.includes("actor_id"), false);
    const authoritativeAsset = await app.inject({ method: "GET", url: authoritativePlace.illustration.url });
    assert.equal(authoritativeAsset.statusCode, 200);
    assert.deepEqual(authoritativeAsset.rawPayload, Buffer.from("89504e470d0a1a0a", "hex"));
    const concealed = authoritative.entities.find((e: any) => e.id === "concealed");
    assert.ok(concealed.illustration.url);
    assert.equal(state.entities.some((e: any) => e.id === "concealed"), false);
    assert.equal((await app.inject({ method: "GET", url: `/games/${game}/entities/concealed/illustration?actor_id=actor` })).statusCode, 404);
    const concealedAsset = await app.inject({ method: "GET", url: concealed.illustration.url });
    assert.equal(concealedAsset.statusCode, 200);
    assert.deepEqual(concealedAsset.rawPayload, Buffer.from("89504e470d0a1a0a", "hex"));
    assert.equal((await app.inject({ method: "GET", url: `/games/${game}/revisions` })).json().length, 1);
    const eventsAfter = db.prepare("SELECT count(*) AS count FROM events WHERE game_id=?").get(game) as { count: number };
    assert.equal(eventsAfter.count, eventsBefore.count);
  } finally { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("expired claims recover", async () => {
  const dir = mkdtempSync(join(tmpdir(), "realm-illustration-"));
  const db = openDatabase(join(dir, "realm.sqlite"));
  const app = buildApp(db, join(dir, "assets"));
  try {
    const game = (await app.inject({ method: "POST", url: "/games", payload: { title: "Test" } })).json().id;
    await app.inject({ method: "POST", url: `/games/${game}/world-patches`, payload: { expected_revision: 0,
      idempotency_key: "seed", entities: [{ id: "place", kind: "place", name: "Place", player: { name: "Place" } }] } });
    const worker = new IllustrationService(db, join(dir, "assets"), async () => ({ action: "skip", reason: "ordinary" }), async () => Buffer.alloc(0));
    const first = worker.claimOne()!;
    db.prepare("UPDATE entity_illustrations SET lease_until=? WHERE game_id=? AND entity_id=?").run("2000-01-01", game, "place");
    const second = worker.claimOne()!;
    assert.notEqual(first.claim_token, second.claim_token);
    assert.equal(await worker.processOne(), false);
    db.prepare("UPDATE entity_illustrations SET lease_until=? WHERE game_id=? AND entity_id=?").run("2000-01-01", game, "place");
    assert.equal(await worker.processOne(), true);
    assert.equal(worker.metadata(game, "place").status, "skipped");
  } finally { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("appearance updates create revisions without regenerating an existing illustration", async () => {
  const dir = mkdtempSync(join(tmpdir(), "realm-illustration-"));
  const db = openDatabase(join(dir, "realm.sqlite"));
  const app = buildApp(db, join(dir, "assets"));
  try {
    const game = (await app.inject({ method: "POST", url: "/games", payload: { title: "Test" } })).json().id;
    const seed = await app.inject({ method: "POST", url: `/games/${game}/world-patches`, payload: {
      expected_revision: 0, idempotency_key: "seed", entities: [
        { id: "place", kind: "place", name: "Greyfen Abbey", description: "A secret crypt lies below", player_visible: true }
      ] } });
    assert.equal(seed.statusCode, 201, seed.body);
    assert.equal(seed.json().revision, 1);
    const contextSeen: Record<string, unknown>[] = [];
    const worker = new IllustrationService(db, join(dir, "assets"), async (context) => {
      contextSeen.push(context);
      return { action: "illustrate", image_prompt: "Greyfen Abbey" };
    }, async () => Buffer.from("89504e470d0a1a0a", "hex"));
    assert.equal(await worker.processOne(), true);
    assert.equal((contextSeen[0].entity as any).appearance, null);
    assert.equal((contextSeen[0].entity as any).name, "Greyfen Abbey");
    assert.equal(worker.metadata(game, "place").status, "illustrated");
    const assetId = worker.metadata(game, "place").asset_id;

    const update = await app.inject({ method: "POST", url: `/games/${game}/world-patches`, payload: {
      expected_revision: 1, idempotency_key: "appearance", entity_updates: [
        { entity_id: "place", appearance: "A roofless stone abbey under ivy" }
      ] } });
    assert.equal(update.statusCode, 201, update.body);
    assert.equal(update.json().revision, 2);
    assert.deepEqual(update.json().events.map((event: any) => event.type), ["EntityUpdated"]);
    const state = (await app.inject({ method: "GET", url: `/games/${game}/authoritative-state` })).json();
    assert.equal(state.entities[0].appearance, "A roofless stone abbey under ivy");
    assert.equal(await worker.processOne(), false);
    assert.equal(worker.metadata(game, "place").asset_id, assetId);
    assert.equal(contextSeen.length, 1);

    const unchanged = await app.inject({ method: "POST", url: `/games/${game}/world-patches`, payload: {
      expected_revision: 2, idempotency_key: "same-appearance", entity_updates: [
        { entity_id: "place", appearance: "A roofless stone abbey under ivy" }
      ] } });
    assert.equal(unchanged.statusCode, 201, unchanged.body);
    assert.equal(unchanged.json().revision, 2);
    assert.deepEqual(unchanged.json().events, []);

    assert.deepEqual((await app.inject({ method: "GET", url: `/games/${game}/revisions` })).json()
      .map((revision: any) => revision.revision_number), [1, 2]);
  } finally { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("migration reconsiders only entities skipped for missing player-facing names", async () => {
  const dir = mkdtempSync(join(tmpdir(), "realm-illustration-"));
  let game: string;
  try {
    const db = openDatabase(join(dir, "realm.sqlite"));
    const app = buildApp(db, join(dir, "assets"));
    try {
      game = (await app.inject({ method: "POST", url: "/games", payload: { title: "Test" } })).json().id;
      const patch = await app.inject({ method: "POST", url: `/games/${game}/world-patches`, payload: {
        expected_revision: 0, idempotency_key: "seed", entities: [
          { id: "place", kind: "place", name: "Canonical place" },
          { id: "other", kind: "item", name: "Ordinary item" }
        ] } });
      assert.equal(patch.statusCode, 201);
      const worker = new IllustrationService(db, join(dir, "assets"), async () => ({ action: "skip" }), async () => Buffer.alloc(0));
      assert.ok(worker.claimOne());
      assert.ok(worker.claimOne());
      db.prepare("UPDATE entity_illustrations SET status='skipped', reason='No player-facing name' WHERE game_id=? AND entity_id='place'").run(game);
      db.prepare("UPDATE entity_illustrations SET status='skipped', reason='ordinary' WHERE game_id=? AND entity_id='other'").run(game);
      db.prepare("DELETE FROM schema_migrations WHERE name='004_reconsider_unnamed_illustrations.sql'").run();
    } finally { await app.close(); db.close(); }

    const reopened = openDatabase(join(dir, "realm.sqlite"));
    try {
      let receivedName: unknown;
      const worker = new IllustrationService(reopened, join(dir, "assets"), async (context: any) => {
        receivedName = context.entity.name;
        return { action: "skip", reason: "not notable" };
      }, async () => Buffer.alloc(0));
      assert.equal(worker.metadata(game, "place").status, "pending");
      assert.equal(worker.metadata(game, "place").attempts, 0);
      assert.equal(worker.metadata(game, "other").status, "skipped");
      assert.equal(await worker.processOne(), true);
      assert.equal(receivedName, "Canonical place");
      assert.equal(worker.metadata(game, "place").reason, "not notable");
      assert.equal(await worker.processOne(), false);
      const revisions = reopened.prepare("SELECT count(*) AS count FROM revisions WHERE game_id=?").get(game) as { count: number };
      assert.equal(revisions.count, 1);
    } finally { reopened.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("appearance migration preserves existing entities and leaves appearance optional", () => {
  const dir = mkdtempSync(join(tmpdir(), "realm-migration-"));
  const filename = join(dir, "realm.sqlite");
  try {
    const legacy = new Database(filename);
    try {
      legacy.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
      for (const name of ["001_initial.sql", "002_idempotency_records.sql", "003_illustrations.sql", "004_reconsider_unnamed_illustrations.sql"]) {
        legacy.exec(readFileSync(join(process.cwd(), "migrations", name), "utf8"));
        legacy.prepare("INSERT INTO schema_migrations(name,applied_at) VALUES (?,?)").run(name, new Date().toISOString());
      }
      legacy.prepare("INSERT INTO games(id,title,created_at) VALUES (?,?,?)").run("game", "Old game", new Date().toISOString());
      legacy.prepare("INSERT INTO entities(game_id,id,kind,name) VALUES (?,?,?,?)").run("game", "abbey", "place", "Greyfen Abbey");
    } finally { legacy.close(); }
    const db = openDatabase(filename);
    try {
      const row = db.prepare("SELECT name,appearance FROM entities WHERE game_id=? AND id=?").get("game", "abbey") as any;
      assert.deepEqual(row, { name: "Greyfen Abbey", appearance: null });
      assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE name='005_entity_appearance.sql'").get());
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("transient failures are recorded for delayed retry without a world revision", async () => {
  const dir = mkdtempSync(join(tmpdir(), "realm-illustration-"));
  const db = openDatabase(join(dir, "realm.sqlite"));
  const app = buildApp(db, join(dir, "assets"));
  try {
    const game = (await app.inject({ method: "POST", url: "/games", payload: { title: "Test" } })).json().id;
    await app.inject({ method: "POST", url: `/games/${game}/world-patches`, payload: { expected_revision: 0,
      idempotency_key: "seed", entities: [{ id: "place", kind: "place", name: "Place", player: { name: "Place" } }] } });
    const worker = new IllustrationService(db, join(dir, "assets"), async () => { throw new Error("temporary API failure"); },
      async () => Buffer.alloc(0));
    assert.equal(await worker.processOne(), true);
    const metadata = worker.metadata(game, "place");
    assert.equal(metadata.status, "failed");
    assert.equal(metadata.attempts, 1);
    assert.ok(metadata.next_retry_at);
    assert.equal(await worker.processOne(), false);
    assert.equal((await app.inject({ method: "GET", url: `/games/${game}/revisions` })).json().length, 1);
  } finally { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
