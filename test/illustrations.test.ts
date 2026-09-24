import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/database.js";
import { buildApp } from "../src/app.js";
import { IllustrationService } from "../src/illustrations.js";

test("illustrations use player fields, remain revisionless, and require actor visibility", async () => {
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
        { id: "hidden", kind: "item", name: "Hidden object", description: "Do not reveal" },
        { id: "concealed", kind: "item", name: "Secret object", player: { name: "A brass key" } }
      ], facts: [{ text: "Hidden murderer", subject_entity_id: "place" }]
    } });
    assert.equal(patch.statusCode, 201);
    const contexts: Record<string, unknown>[] = [];
    const worker = new IllustrationService(db, join(dir, "assets"), async (context) => {
      contexts.push(context);
      return { action: "illustrate", image_prompt: "A stone tower" };
    }, async () => Buffer.from("89504e470d0a1a0a", "hex"));
    for (let i = 0; i < 5; i++) assert.equal(await worker.processOne(), true);
    assert.equal(await worker.processOne(), false);
    assert.equal(contexts.length, 2);
    assert.match(JSON.stringify(contexts), /Visible place/);
    assert.doesNotMatch(JSON.stringify(contexts), /Hidden treasure|Hidden murderer|Secret real name/);
    const state = (await app.inject({ method: "GET", url: `/games/${game}/state?actor_id=actor` })).json();
    const place = state.entities.find((e: any) => e.id === "place");
    assert.equal(place.illustration.status, "illustrated");
    const asset = await app.inject({ method: "GET", url: place.illustration.url });
    assert.equal(asset.statusCode, 200);
    assert.deepEqual(asset.rawPayload, Buffer.from("89504e470d0a1a0a", "hex"));
    const hidden = await app.inject({ method: "GET", url: `/games/${game}/entities/hidden/illustration?actor_id=actor` });
    assert.equal(hidden.statusCode, 404);
    const authoritative = (await app.inject({ method: "GET", url: `/games/${game}/authoritative-state` })).json();
    assert.equal(authoritative.game.current_revision, 1);
    assert.equal(authoritative.entities.find((e: any) => e.id === "hidden").illustration.status, "skipped");
    assert.equal(authoritative.entities.find((e: any) => e.id === "hidden").illustration.url, undefined);
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
