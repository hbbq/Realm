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

test("companion lists games and serves its same-origin inspector", async () => {
  const { app } = harness();
  const empty = await app.inject({ method: "GET", url: "/games" });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json(), []);

  const first = await createGame(app, "Greyfen");
  const second = await createGame(app, "Other");
  const games = await app.inject({ method: "GET", url: "/games" });
  assert.equal(games.statusCode, 200);
  assert.deepEqual(games.json().map((game: any) => game.id), [first, second]);
  assert.deepEqual(games.json().map((game: any) => game.title), ["Greyfen", "Other"]);
  assert.equal(games.json()[0].current_revision, 0);
  assert.equal("definition" in games.json()[0], false);

  const page = await app.inject({ method: "GET", url: "/companion" });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers["content-type"] || "", /text\/html/);
  assert.match(page.body, /Realm Web Companion/);
  assert.match(page.body, /\/authoritative-state/);
  assert.match(page.body, /actor_id=/);
  assert.match(page.body, /\/revisions/);
});

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

test("player state does not expose revisions from hidden world changes", async () => {
  const { app } = harness();
  const gameId = await createGame(app);
  const seed = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 0, idempotency_key: "visible-seed",
    entities: [{ id: "hero", kind: "creature", name: "Hero" }]
  }});
  assert.equal(seed.statusCode, 201, seed.body);
  const before = (await app.inject({ method: "GET", url: `/games/${gameId}/state?actor_id=hero` })).json();
  assert.equal("current_revision" in before.game, false);

  const hidden = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 1, idempotency_key: "hidden-change",
    entities: [{ id: "secret", kind: "item", name: "Secret" }]
  }});
  assert.equal(hidden.statusCode, 201, hidden.body);
  const after = (await app.inject({ method: "GET", url: `/games/${gameId}/state?actor_id=hero` })).json();
  assert.deepEqual(after, before);
  assert.equal((await app.inject({ method: "GET", url: `/games/${gameId}/authoritative-state` })).json().game.current_revision, 2);
});

test("WorldPatch rejects refs that collide with addressable IDs", async () => {
  const { app } = harness();
  const gameId = await createGame(app);
  const seed = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 0, idempotency_key: "collision-seed",
    entities: [{ id: "existing-place", kind: "place", name: "Existing" }]
  }});
  assert.equal(seed.statusCode, 201, seed.body);

  const collision = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 1, idempotency_key: "ambiguous-ref",
    entities: [
      { ref: "existing-place", kind: "place", name: "Other" },
      { id: "child", kind: "item", name: "Child" }
    ],
    containment: [{ child_id: "child", parent_id: "existing-place" }]
  }});
  assert.equal(collision.statusCode, 400, collision.body);
  assert.equal(collision.json().error, "REF_ID_COLLISION");

  const newIdCollision = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 1, idempotency_key: "new-id-ambiguous-ref",
    entities: [
      { id: "new-place", kind: "place", name: "New" },
      { ref: "new-place", kind: "place", name: "Other" }
    ]
  }});
  assert.equal(newIdCollision.statusCode, 400, newIdCollision.body);
  assert.equal(newIdCollision.json().error, "REF_ID_COLLISION");

  const state = (await app.inject({ method: "GET", url: `/games/${gameId}/authoritative-state` })).json();
  assert.deepEqual(state.entities.map((entity: any) => entity.id), ["existing-place"]);
  assert.equal(state.game.current_revision, 1);
});

test("repeated knowledge and observation writes emit only real transitions", async () => {
  const { app } = harness();
  const gameId = await createGame(app);
  const seed = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 0, idempotency_key: "transition-seed",
    entities: [
      { id: "actor", kind: "creature", name: "Actor" },
      { id: "clue", kind: "item", name: "Clue" }
    ],
    facts: [{ id: "fact", text: "A useful fact." }]
  }});
  assert.equal(seed.statusCode, 201, seed.body);

  const transitions = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 1, idempotency_key: "duplicate-transitions",
    knowledge: [{ actor_id: "actor", fact_id: "fact" }, { actor_id: "actor", fact_id: "fact" }],
    observations: [{ actor_id: "actor", entity_id: "clue" }, { actor_id: "actor", entity_id: "clue" }]
  }});
  assert.equal(transitions.statusCode, 201, transitions.body);
  assert.deepEqual(transitions.json().events.map((event: any) => event.type), ["FactRevealed", "EntityObserved"]);

  const repeatedReveal = await app.inject({ method: "POST", url: `/games/${gameId}/operations/reveal-fact`, payload: {
    expected_revision: 2, idempotency_key: "repeat-reveal", actor_id: "actor", fact_id: "fact"
  }});
  assert.equal(repeatedReveal.statusCode, 200, repeatedReveal.body);
  assert.equal(repeatedReveal.json().revision, 2);
  assert.deepEqual(repeatedReveal.json().events, []);

  const repeatedObservation = await app.inject({ method: "POST", url: `/games/${gameId}/operations/observe-entity`, payload: {
    expected_revision: 2, idempotency_key: "repeat-observation", actor_id: "actor", entity_id: "clue"
  }});
  assert.equal(repeatedObservation.statusCode, 200, repeatedObservation.body);
  assert.equal(repeatedObservation.json().revision, 2);
  assert.deepEqual(repeatedObservation.json().events, []);

  const advance = await app.inject({ method: "POST", url: `/games/${gameId}/operations/advance-time`, payload: {
    expected_revision: 2, idempotency_key: "intervening-change", minutes: 1
  }});
  assert.equal(advance.statusCode, 200, advance.body);
  assert.equal(advance.json().revision, 3);

  const revealRetry = await app.inject({ method: "POST", url: `/games/${gameId}/operations/reveal-fact`, payload: {
    expected_revision: 2, idempotency_key: "repeat-reveal", actor_id: "actor", fact_id: "fact"
  }});
  assert.equal(revealRetry.statusCode, 200, revealRetry.body);
  assert.deepEqual(revealRetry.json(), { ...repeatedReveal.json(), idempotent: true });

  const state = (await app.inject({ method: "GET", url: `/games/${gameId}/authoritative-state` })).json();
  assert.equal(state.game.current_revision, 3);
  assert.equal(state.knowledge.length, 1);
  assert.equal(state.observations.length, 1);
  const revisions = (await app.inject({ method: "GET", url: `/games/${gameId}/revisions` })).json();
  assert.deepEqual(revisions.map((revision: any) => revision.revision_number), [1, 2, 3]);
});

test("moves and world patches omit audit transitions for unchanged state", async () => {
  const { app } = harness();
  const gameId = await createGame(app);
  const seed = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 0, idempotency_key: "noop-seed",
    entities: [
      { id: "room", kind: "place", name: "Room" },
      { id: "actor", kind: "creature", name: "Actor", description: "Still here", properties: { a: 1, b: 2 }, player: { properties: { seen: true } }, player_visible: true }
    ],
    containment: [{ child_id: "actor", parent_id: "room" }]
  }});
  assert.equal(seed.statusCode, 201, seed.body);

  const move = await app.inject({ method: "POST", url: `/games/${gameId}/operations/move`, payload: {
    expected_revision: 1, idempotency_key: "same-move", entity_id: "actor", destination_id: "room"
  }});
  assert.equal(move.statusCode, 200, move.body);
  assert.equal(move.json().revision, 1);
  assert.deepEqual(move.json().events, []);

  const patch = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 1, idempotency_key: "same-patch",
    entity_updates: [
      { entity_id: "actor" },
      { entity_id: "actor", name: "Actor", description: "Still here", properties: { b: 2, a: 1 }, player: { properties: { seen: true } }, player_visible: true }
    ],
    containment: [{ child_id: "actor", parent_id: "room" }]
  }});
  assert.equal(patch.statusCode, 201, patch.body);
  assert.equal(patch.json().revision, 1);
  assert.deepEqual(patch.json().events, []);

  const state = (await app.inject({ method: "GET", url: `/games/${gameId}/authoritative-state` })).json();
  assert.equal(state.game.current_revision, 1);
  const revisions = (await app.inject({ method: "GET", url: `/games/${gameId}/revisions` })).json();
  assert.deepEqual(revisions.map((revision: any) => revision.revision_number), [1]);
});

test("idempotency keys are bound to mutation kind and stable request payload", async () => {
  const { app } = harness();
  const gameId = await createGame(app);
  const seed = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 0, idempotency_key: "binding-seed",
    entities: [{ id: "actor", kind: "creature", name: "Actor", properties: { first: 1, second: 2 } }]
  }});
  assert.equal(seed.statusCode, 201, seed.body);

  const reorderedRetry = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    idempotency_key: "binding-seed", expected_revision: 0,
    entities: [{ properties: { second: 2, first: 1 }, name: "Actor", kind: "creature", id: "actor" }]
  }});
  assert.equal(reorderedRetry.statusCode, 201, reorderedRetry.body);
  assert.deepEqual(reorderedRetry.json(), { ...seed.json(), idempotent: true });

  const changedPayload = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 0, idempotency_key: "binding-seed",
    entities: [{ id: "actor", kind: "creature", name: "Changed" }]
  }});
  assert.equal(changedPayload.statusCode, 409, changedPayload.body);
  assert.equal(changedPayload.json().error, "IDEMPOTENCY_KEY_REUSED");

  const changedKind = await app.inject({ method: "POST", url: `/games/${gameId}/operations/advance-time`, payload: {
    expected_revision: 0, idempotency_key: "binding-seed", minutes: 5
  }});
  assert.equal(changedKind.statusCode, 409, changedKind.body);
  assert.equal(changedKind.json().error, "IDEMPOTENCY_KEY_REUSED");

  const state = (await app.inject({ method: "GET", url: `/games/${gameId}/authoritative-state` })).json();
  assert.equal(state.game.current_revision, 1);
  assert.equal(state.game.world_time_minutes, 0);
  assert.equal(state.entities[0].name, "Actor");
});

test("runtime batch commits ordered dependent changes in one revision and retries exactly", async () => {
  const { app } = harness();
  const gameId = await createGame(app);
  const seed = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 0, idempotency_key: "seed", entities: [
      { id: "actor", kind: "creature", name: "Actor" },
      { id: "room-a", kind: "place", name: "A" },
      { id: "room-b", kind: "place", name: "B" },
      { id: "item", kind: "item", name: "Item" }
    ], containment: [{ child_id: "actor", parent_id: "room-a" }, { child_id: "item", parent_id: "actor" }]
  }});
  assert.equal(seed.statusCode, 201, seed.body);
  const payload = { expected_revision: 1, idempotency_key: "scene", changes: [
    { type: "move", entity_id: "actor", destination_id: "room-b" },
    { type: "move", entity_id: "item", destination_id: "room-b" },
    { type: "establish_fact", id: "clue", text: "A clue", subject_entity_id: "item" },
    { type: "reveal_fact", actor_id: "actor", fact_id: "clue" },
    { type: "observe_entity", actor_id: "actor", entity_id: "item" },
    { type: "advance_time", minutes: 3 }
  ] };
  const result = await app.inject({ method: "POST", url: `/games/${gameId}/operations/batch`, payload });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().revision, 2);
  assert.equal(result.json().world_time_minutes, 3);
  assert.deepEqual(result.json().created_facts, [{ change_index: 2, fact_id: "clue" }]);
  assert.deepEqual(result.json().events.map((event: any) => event.type),
    ["EntityMoved", "EntityMoved", "FactEstablished", "FactRevealed", "EntityObserved", "TimeAdvanced"]);
  assert.deepEqual(result.json().events.map((event: any) => event.ordinal), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(result.json().events.map((event: any) => event.payload.change_index), [0, 1, 2, 3, 4, 5]);
  const events = (await app.inject({ method: "GET", url: `/games/${gameId}/revisions/2/events` })).json();
  assert.deepEqual(events.map((event: any) => event.type), result.json().events.map((event: any) => event.type));
  const revisions = (await app.inject({ method: "GET", url: `/games/${gameId}/revisions` })).json();
  assert.deepEqual(revisions.map((revision: any) => revision.mutation_kind), ["world_patch", "runtime_batch"]);
  const state = (await app.inject({ method: "GET", url: `/games/${gameId}/authoritative-state` })).json();
  assert.equal(state.knowledge[0].learned_revision, 2);
  assert.equal(state.observations[0].observed_revision, 2);

  const later = await app.inject({ method: "POST", url: `/games/${gameId}/operations/advance-time`, payload: {
    expected_revision: 2, idempotency_key: "later", minutes: 1
  }});
  assert.equal(later.statusCode, 200, later.body);
  const retry = await app.inject({ method: "POST", url: `/games/${gameId}/operations/batch`, payload });
  assert.equal(retry.statusCode, 200, retry.body);
  assert.deepEqual(retry.json(), { ...result.json(), idempotent: true });
  const reused = await app.inject({ method: "POST", url: `/games/${gameId}/operations/batch`, payload: {
    ...payload, changes: [...payload.changes].reverse()
  }});
  assert.equal(reused.statusCode, 409);
  assert.equal(reused.json().error, "IDEMPOTENCY_KEY_REUSED");
});

test("runtime batch rolls back a later invalid step and preserves no-op semantics", async () => {
  const { app } = harness();
  const gameId = await createGame(app);
  const otherId = await createGame(app);
  const seed = await app.inject({ method: "POST", url: `/games/${gameId}/world-patches`, payload: {
    expected_revision: 0, idempotency_key: "seed", entities: [
      { id: "actor", kind: "creature", name: "Actor" }, { id: "room", kind: "place", name: "Room" }
    ], containment: [{ child_id: "actor", parent_id: "room" }]
  }});
  assert.equal(seed.statusCode, 201, seed.body);
  const bad = await app.inject({ method: "POST", url: `/games/${gameId}/operations/batch`, payload: {
    expected_revision: 1, idempotency_key: "bad", changes: [
      { type: "establish_fact", id: "temporary", text: "Temporary" },
      { type: "advance_time", minutes: 5 },
      { type: "move", entity_id: "room", destination_id: "actor" }
    ]
  }});
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error, "CONTAINMENT_CYCLE");
  let state = (await app.inject({ method: "GET", url: `/games/${gameId}/authoritative-state` })).json();
  assert.equal(state.game.current_revision, 1);
  assert.equal(state.game.world_time_minutes, 0);
  assert.deepEqual(state.facts, []);
  const crossGame = await app.inject({ method: "POST", url: `/games/${otherId}/operations/batch`, payload: {
    expected_revision: 0, idempotency_key: "cross", changes: [
      { type: "advance_time", minutes: 2 }, { type: "observe_entity", actor_id: "actor", entity_id: "room" }
    ]
  }});
  assert.equal(crossGame.statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: `/games/${otherId}/authoritative-state` })).json().game.world_time_minutes, 0);
  const stale = await app.inject({ method: "POST", url: `/games/${gameId}/operations/batch`, payload: {
    expected_revision: 0, idempotency_key: "stale", changes: [{ type: "advance_time", minutes: 1 }]
  }});
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error, "REVISION_CONFLICT");
  const noop = await app.inject({ method: "POST", url: `/games/${gameId}/operations/batch`, payload: {
    expected_revision: 1, idempotency_key: "noop", changes: [
      { type: "move", entity_id: "actor", destination_id: "room" },
      { type: "observe_entity", actor_id: "actor", entity_id: "room" },
      { type: "observe_entity", actor_id: "actor", entity_id: "room" }
    ]
  }});
  assert.equal(noop.statusCode, 200, noop.body);
  assert.equal(noop.json().revision, 2);
  assert.deepEqual(noop.json().events.map((event: any) => event.type), ["EntityObserved"]);
  assert.equal(noop.json().events[0].payload.change_index, 1);
  const allNoop = await app.inject({ method: "POST", url: `/games/${gameId}/operations/batch`, payload: {
    expected_revision: 2, idempotency_key: "all-noop", changes: [
      { type: "move", entity_id: "actor", destination_id: "room" },
      { type: "observe_entity", actor_id: "actor", entity_id: "room" }
    ]
  }});
  assert.equal(allNoop.statusCode, 200, allNoop.body);
  assert.equal(allNoop.json().revision, 2);
  assert.deepEqual(allNoop.json().events, []);
  assert.equal(allNoop.json().world_time_minutes, 0);
  assert.deepEqual(allNoop.json().created_facts, []);
  const allNoopRetry = await app.inject({ method: "POST", url: `/games/${gameId}/operations/batch`, payload: {
    expected_revision: 2, idempotency_key: "all-noop", changes: [
      { type: "move", entity_id: "actor", destination_id: "room" },
      { type: "observe_entity", actor_id: "actor", entity_id: "room" }
    ]
  }});
  assert.deepEqual(allNoopRetry.json(), { ...allNoop.json(), idempotent: true });
  const generated = await app.inject({ method: "POST", url: `/games/${gameId}/operations/batch`, payload: {
    expected_revision: 2, idempotency_key: "generated", changes: [{ type: "establish_fact", text: "Generated ID" }]
  }});
  assert.equal(generated.statusCode, 200, generated.body);
  assert.equal(generated.json().created_facts[0].change_index, 0);
  assert.equal(generated.json().created_facts[0].fact_id, generated.json().events[0].payload.fact_id);
  const invalid = await app.inject({ method: "POST", url: `/games/${gameId}/operations/batch`, payload: {
    expected_revision: 3, idempotency_key: "invalid", changes: [{ type: "move", entity_id: "actor", to: "room" }]
  }});
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error, "INVALID_REQUEST");
  state = (await app.inject({ method: "GET", url: `/games/${gameId}/authoritative-state` })).json();
  assert.equal(state.game.current_revision, 3);
});
