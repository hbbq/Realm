# Realm v1 vertical slice

Realm is a small standalone HTTP service for authoritative role-playing world state. This slice proves the state boundaries in [VISION.md](VISION.md) and [STATE_MODEL.md](STATE_MODEL.md) without Keeper or Resident. Optional illustration generation uses OpenAI independently of gameplay. A minimal read-only Web Companion is included for inspection.

## Run

Requires Node.js 20 or newer.

```sh
npm install
npm test
npm run build
REALM_DATABASE=realm.sqlite npm start
```

The server listens on `127.0.0.1:3000` by default. `HOST` and `PORT` override this. SQL migrations in `migrations/` run at startup.

Entity illustration generation is optional and disabled by default. Set `REALM_ILLUSTRATIONS_ENABLED=true` and `OPENAI_API_KEY` to run one background job at a time inside Realm. `REALM_ILLUSTRATION_DIR` selects the persistent image directory (default `illustrations`); back it up together with the SQLite database. `REALM_ILLUSTRATION_TEXT_MODEL` and `REALM_ILLUSTRATION_IMAGE_MODEL` override the default text and image models. A game definition may contain `illustration: { "enabled": true, "style": "...", "policy": "..." }`; `enabled: false` excludes that game. Existing entities enter the pending queue automatically. Interrupted jobs are reclaimed after five minutes; failures retry with exponential delay up to five attempts. Generated images do not change world revisions or facts. The first slice keeps one active image per entity and does not regenerate after edits. Without an API key Realm still serves gameplay and previously generated assets.

Open `http://127.0.0.1:3000/companion` to inspect a game. Select a game, then choose **All** for authoritative state or a creature actor for Realm's player projection. The Map tab shows places, contents, and connections from the selected state; it loads Mermaid from jsDelivr, so the map needs internet access. The revision list loads each revision's events when opened. The companion and history are trusted developer/GM surfaces and expose hidden canon; the service has no authentication. Serve it only in a trusted environment.

## API surface

The API is intentionally split into trusted authoring/inspection routes and actor-scoped player reads. V1 is a trusted development service and has no authentication.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/games` | Create a game at revision 0 |
| `GET` | `/games` | List games for selection (ID, title, world time, revision, creation time) |
| `GET` | `/companion` | Open the read-only Web Companion |
| `POST` | `/games/:id/world-patches` | Atomically materialize related entities, containment, connections, facts, knowledge, and observations |
| `POST` | `/games/:id/operations/move` | Change one entity's physical parent |
| `POST` | `/games/:id/operations/advance-time` | Advance the authoritative clock |
| `POST` | `/games/:id/operations/establish-fact` | Add canonical truth |
| `POST` | `/games/:id/operations/reveal-fact` | Grant an actor knowledge of a fact |
| `POST` | `/games/:id/operations/observe-entity` | Record that an actor may see an entity in player projections |
| `POST` | `/games/:id/operations/batch` | Apply ordered runtime changes in one atomic transition |
| `GET` | `/games/:id/state?actor_id=...` | Read a player-safe projection |
| `GET` | `/games/:id/authoritative-state` | Inspect trusted canonical state |
| `GET` | `/games/:id/entities/:entityId/illustration?actor_id=...` | Read an illustrated entity's image when visible to that actor |
| `GET` | `/games/:id/revisions` | List mutation revisions |
| `GET` | `/games/:id/revisions/:number/events` | Inspect durable events for one revision |

Every mutation body includes `expected_revision` and `idempotency_key`. A stale revision returns HTTP 409. Retrying a completed key returns its original result and does not apply the change twice.

WorldPatch references may use persisted IDs or request-local `ref` values. Created-record events return each supplied `ref` with its durable ID. Realm resolves the whole proposed graph, checks references, place connection endpoints, creature actors, single-parent containment, and cycles, then commits state, one revision, and its events in one SQLite transaction.

The trusted batch route accepts one `expected_revision`, one `idempotency_key`, and `changes` containing 1–100 ordered operations. Each change has a `type` of `move` (`entity_id`, `destination_id`), `establish_fact` (`text`, optional `id`, `subject_entity_id`, `metadata`), `reveal_fact` (`actor_id`, `fact_id`), `observe_entity` (`actor_id`, `entity_id`), or `advance_time` (`minutes`). The individual operation routes remain available. Changes run in order against the state produced by earlier changes, so a fact with an explicit `id` may be established and then revealed in the same batch. Each step uses its single-operation validation, including sequential containment cycle checks. A failed step rolls back all earlier steps. WorldPatch remains a separate operation.

For example:

```json
{
  "expected_revision": 4,
  "idempotency_key": "scene-5",
  "changes": [
    { "type": "move", "entity_id": "mara", "destination_id": "abbey" },
    { "type": "establish_fact", "id": "clue", "text": "Mara saw the visitor." },
    { "type": "reveal_fact", "actor_id": "elin", "fact_id": "clue" },
    { "type": "advance_time", "minutes": 3 }
  ]
}
```

A successful batch returns one revision, its ordered events, `world_time_minutes`, and `created_facts` entries with the zero-based `change_index` and durable `fact_id`. Each batch event payload also includes its `change_index`, so events remain attributable when some steps are unchanged. A retry with the same key and ordered request returns the stored result with `idempotent: true`, even after later revisions. Changing or reordering steps under the same key returns HTTP 409. Unchanged steps emit no event; a wholly unchanged batch keeps the current revision. The batch response is authoritative and may include hidden facts, so only trusted clients should use it.

## Visibility contract

The actor-scoped route is a purpose-built projection:

- Canonical fact text appears only after that actor has fact knowledge. Authoring metadata is omitted, and a subject ID appears only when that entity is also visible.
- Entities appear when marked inherently `player_visible`, explicitly observed by that actor, or when the entity is the actor itself. Their name, description, and properties come from an explicit `player` projection; canonical authoring fields are never serialized by this route. An actor's own name is the only fallback.
- Containment appears only when both ends are visible.
- Connections require an explicit player-visible flag and visible endpoints.
- Learning a fact does not automatically expose its subject entity.
- The player projection omits the authoritative revision so hidden mutations cannot be inferred from revision changes.
- Revisions, events, game definitions, and the authoritative-state route are trusted surfaces and must not be presented directly to players.

This is deliberately smaller than a general ACL or per-field visibility system.

The worker only uses explicit player-facing entity fields, a player-visible parent name, and the game's visual guidance to build a shared player-facing image. It omits canonical fields and facts because fact knowledge is actor-specific. Entities without a player-facing name are explicitly skipped. Actor state includes illustration status and a scoped image URL when illustrated; authoritative state includes worker metadata. The image route checks the same entity visibility rule as actor state. Since the service has no authentication, callers can supply any actor ID; deploy behind a trusted boundary.

## Architecture and scope

The service is a modular monolith: Fastify and TypeBox handle JSON/HTTP validation, `RealmService` owns commands and invariants, and `better-sqlite3` owns persistence. SQLite keeps deployment and transaction behavior simple for a single small service. WAL mode, foreign keys, a busy timeout, optimistic revision checks, and short transactions provide an adequate v1 concurrency model. A higher-write deployment can later replace the persistence adapter. Versioned raw SQL migrations keep composite keys and constraints explicit and avoid adding an ORM abstraction before the query model warrants one.

State tables are the current read model. Append-only revision and event tables provide durable historical identity and audit data, but state is not replayed from events. This preserves a path to richer history without requiring event sourcing, rollback, or forks now.

Facts use text, an optional entity subject, and metadata. Entity properties are a constrained JSON extension point. This avoids committing v1 to a universal ontology or component engine while relational tables enforce the invariants the Greyfen scenario needs.

Included now: games, place/creature/item entities, containment, place connections, facts, actor knowledge, observations, atomic WorldPatch, move/reveal/observe/establish/time operations, revisions, events, world time, isolated game scope, and optional entity illustrations.

Deferred: authentication, generic components, factions, situations, beliefs, schedules, portals and locks, ownership, combat, rules and dice, rollback, replay, branching, richer visibility, Resident, Keeper, and other AI integration.

## Tests

Integration tests use Fastify's HTTP injection against a disposable real SQLite database. The Greyfen flow creates and seeds a game, proves hidden state stays out of an actor projection, reveals knowledge, observes and moves entities, advances time, and inspects revisions/events. Focused assertions cover failed-patch rollback, containment cycles, cross-game references, stale revisions, and idempotent retry.
