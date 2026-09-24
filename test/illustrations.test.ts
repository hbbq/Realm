import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
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
        { id: "place", kind: "place", name: "Secret real name", description: "Hidden treasure", player: {
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
    assert.equal(hiddenContext.entity.description, "");
    assert.equal(hiddenContext.entity.properties, "{}");
    assert.doesNotMatch(JSON.stringify(contexts), /Hidden treasure|Hidden murderer|Secret real name|Do not reveal|Buried gold|Secret object/);
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
