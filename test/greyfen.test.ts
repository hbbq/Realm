import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { RealmDatabase } from "../src/database.js";
import { openDatabase } from "../src/database.js";
import { buildApp } from "../src/app.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

function harness(): { app: FastifyInstance; db: RealmDatabase } {
  const directory = mkdtempSync(join(tmpdir(), "realm-test-"));
  const db = openDatabase(join(directory, "realm.sqlite"));
  const app = buildApp(db);
  cleanups.push(async () => { await app.close(); db.close(); rmSync(directory, { recursive: true, force: true }); });
  return { app, db };
}

async function createGame(app: FastifyInstance, title = "Greyfen") {
  const response = await app.inject({ method: "POST", url: "/games", payload: { title, definition: { tone: "low fantasy" } } });
  assert.equal(response.statusCode, 201);
  return response.json().id as string;
}

test("Greyfen scenario exercises the complete API slice without leaking hidden canon", async () => {
  const { app } = harness();
  const gameId = await createGame(app);
  const seed = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 0, idempotency_key: "greyfen-seed",
    entities: [
      { ref: "square", kind: "place", name: "Greyfen Square", description: "DM notes about the square.", player: { name: "Greyfen Square", description: "A rain-dark square." }, player_visible: true },
      { ref: "cellar", kind: "place", name: "Inn Cellar", description: "A hidden cellar.", player: { name: "Inn Cellar", description: "A cramped stone cellar." } },
      { ref: "elin", kind: "creature", name: "Elin" },
      { ref: "mara", kind: "creature", name: "Mara", description: "DM-only motive.", player: { name: "Mara", description: "The innkeeper." }, player_visible: true },
      { ref: "varek", kind: "creature", name: "Varek", description: "The hidden culprit." },
      { ref: "lantern", kind: "item", name: "Lantern", player: { name: "Lantern" } },
      { ref: "key", kind: "item", name: "Iron Key" }
    ],
    containment: [
      { child_id: "elin", parent_id: "square" }, { child_id: "mara", parent_id: "square" },
      { child_id: "varek", parent_id: "cellar" }, { child_id: "lantern", parent_id: "elin" },
      { child_id: "key", parent_id: "cellar" }
    ],
    connections: [{ ref: "stairs", from_place_id: "square", to_place_id: "cellar", typical_travel_minutes: 1 }],
    facts: [
      { ref: "weather", text: "Rain has made the square muddy.", subject_entity_id: "square" },
      { ref: "culprit", text: "Varek stole the abbey seal.", subject_entity_id: "varek", metadata: { secret: true } }
    ],
    knowledge: [{ actor_id: "elin", fact_id: "weather" }],
    observations: [
      { actor_id: "elin", entity_id: "square" }, { actor_id: "elin", entity_id: "mara" },
      { actor_id: "elin", entity_id: "lantern" }
    ]
  }});
  assert.equal(seed.statusCode, 201, seed.body);
  assert.equal(seed.json().revision, 1);
  const trusted = (await app.inject({ method: "GET", url: `/games/${gameId}/authoritative-state` })).json();
  const byName = Object.fromEntries(trusted.entities.map((entity: any) => [entity.name, entity.id]));
  const byText = Object.fromEntries(trusted.facts.map((fact: any) => [fact.text, fact.id]));
  assert.equal(trusted.entities.length, 7);
  assert.equal(trusted.facts.length, 2);

  let player = (await app.inject({ method: "GET", url: `/games/${gameId}/state?actor_id=${byName.Elin}` })).json();
  assert.deepEqual(player.entities.map((entity: any) => entity.name).sort(), ["Elin", "Greyfen Square", "Lantern", "Mara"]);
  assert.deepEqual(player.facts.map((fact: any) => fact.text), ["Rain has made the square muddy."]);
  assert.equal(player.connections.length, 0);
  assert.equal(JSON.stringify(player).includes("Varek stole"), false);
  assert.equal(JSON.stringify(player).includes("hidden cellar"), false);
  assert.equal(JSON.stringify(player).includes("DM-only motive"), false);
  assert.equal(JSON.stringify(player).includes("DM notes"), false);

  const reveal = await app.inject({ method: "POST", url: `/games/${gameId}/operations/reveal-fact`, payload: {
    expected_revision: 1, idempotency_key: "reveal-culprit", actor_id: byName.Elin, fact_id: byText["Varek stole the abbey seal."]
  }});
  assert.equal(reveal.statusCode, 200, reveal.body);
  assert.equal(reveal.json().revision, 2);
  player = (await app.inject({ method: "GET", url: `/games/${gameId}/state?actor_id=${byName.Elin}` })).json();
  assert.equal(player.facts.some((fact: any) => fact.text === "Varek stole the abbey seal."), true);
  assert.equal(player.entities.some((entity: any) => entity.name === "Varek"), false, "knowing a fact does not expose its subject entity");

  const observe = await app.inject({ method: "POST", url: `/games/${gameId}/operations/observe-entity`, payload: {
    expected_revision: 2, idempotency_key: "observe-cellar", actor_id: byName.Elin, entity_id: byName["Inn Cellar"]
  }});
  assert.equal(observe.statusCode, 200);
  const move = await app.inject({ method: "POST", url: `/games/${gameId}/operations/move`, payload: {
    expected_revision: 3, idempotency_key: "enter-cellar", entity_id: byName.Elin, destination_id: byName["Inn Cellar"]
  }});
  assert.equal(move.statusCode, 200);
  const moveLantern = await app.inject({ method: "POST", url: `/games/${gameId}/operations/move`, payload: {
    expected_revision: 4, idempotency_key: "set-down-lantern", entity_id: byName.Lantern, destination_id: byName["Inn Cellar"]
  }});
  assert.equal(moveLantern.statusCode, 200);
  const time = await app.inject({ method: "POST", url: `/games/${gameId}/operations/advance-time`, payload: {
    expected_revision: 5, idempotency_key: "search-cellar", minutes: 20
  }});
  assert.equal(time.statusCode, 200);
  assert.deepEqual(time.json().events[0].payload, { minutes: 20, from: 0, to: 20 });

  const state = (await app.inject({ method: "GET", url: `/games/${gameId}/authoritative-state` })).json();
  assert.equal(state.game.current_revision, 6);
  assert.equal(state.game.world_time_minutes, 20);
  assert.deepEqual(state.containment.find((edge: any) => edge.child_entity_id === byName.Elin), { child_entity_id: byName.Elin, parent_entity_id: byName["Inn Cellar"] });
  assert.deepEqual(state.containment.find((edge: any) => edge.child_entity_id === byName.Lantern), { child_entity_id: byName.Lantern, parent_entity_id: byName["Inn Cellar"] });
  const revisions = (await app.inject({ method: "GET", url: `/games/${gameId}/revisions` })).json();
  assert.deepEqual(revisions.map((revision: any) => revision.revision_number), [1, 2, 3, 4, 5, 6]);
  const events = (await app.inject({ method: "GET", url: `/games/${gameId}/revisions/6/events` })).json();
  assert.equal(events[0].type, "TimeAdvanced");

  const retry = await app.inject({ method: "POST", url: `/games/${gameId}/operations/advance-time`, payload: {
    expected_revision: 5, idempotency_key: "search-cellar", minutes: 20
  }});
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().idempotent, true);
  assert.equal((await app.inject({ method: "GET", url: `/games/${gameId}/authoritative-state` })).json().game.world_time_minutes, 20);
});

test("invalid patches and revision conflicts are atomic and game scoped", async () => {
  const { app } = harness();
  const gameId = await createGame(app, "One");
  const otherGameId = await createGame(app, "Two");
  const seed = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 0, idempotency_key: "seed", entities: [
      { id: "room-a", kind: "place", name: "A" }, { id: "room-b", kind: "place", name: "B" }
    ], containment: [{ child_id: "room-b", parent_id: "room-a" }]
  }});
  assert.equal(seed.statusCode, 201, seed.body);

  const cycle = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 1, idempotency_key: "bad-cycle", entities: [{ id: "temporary", kind: "item", name: "Must roll back" }],
    containment: [{ child_id: "room-a", parent_id: "room-b" }]
  }});
  assert.equal(cycle.statusCode, 400);
  assert.equal(cycle.json().error, "CONTAINMENT_CYCLE");
  const state = (await app.inject({ method: "GET", url: `/games/${gameId}/authoritative-state` })).json();
  assert.equal(state.entities.some((entity: any) => entity.id === "temporary"), false);
  assert.equal(state.game.current_revision, 1);

  const crossGame = await app.inject({ method: "POST", url: `/games/${otherGameId}/operations/move`, payload: {
    expected_revision: 0, idempotency_key: "cross-game", entity_id: "room-a", destination_id: "room-b"
  }});
  assert.equal(crossGame.statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: `/games/${otherGameId}/authoritative-state` })).json().game.current_revision, 0);

  const conflict = await app.inject({ method: "POST", url: `/games/${gameId}/operations/advance-time`, payload: {
    expected_revision: 0, idempotency_key: "stale", minutes: 1
  }});
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error, "REVISION_CONFLICT");
});
