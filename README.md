# Realm v1 vertical slice

Realm is a small standalone HTTP service for authoritative role-playing world state. This slice proves the state boundaries in [VISION.md](VISION.md) and [STATE_MODEL.md](STATE_MODEL.md) without Keeper, Resident, a UI, or any AI dependency.

## Run

Requires Node.js 20 or newer.

```sh
npm install
npm test
npm run build
REALM_DATABASE=realm.sqlite npm start
```

The server listens on `127.0.0.1:3000` by default. `HOST` and `PORT` override this. SQL migrations in `migrations/` run at startup.

## API surface

The API is intentionally split into trusted authoring/inspection routes and actor-scoped player reads. V1 is a trusted development service and has no authentication.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/games` | Create a game at revision 0 |
| `POST` | `/games/:id/world-patches` | Atomically materialize related entities, containment, connections, facts, knowledge, and observations |
| `POST` | `/games/:id/operations/move` | Change one entity's physical parent |
| `POST` | `/games/:id/operations/advance-time` | Advance the authoritative clock |
| `POST` | `/games/:id/operations/establish-fact` | Add canonical truth |
| `POST` | `/games/:id/operations/reveal-fact` | Grant an actor knowledge of a fact |
| `POST` | `/games/:id/operations/observe-entity` | Record that an actor may see an entity in player projections |
| `GET` | `/games/:id/state?actor_id=...` | Read a player-safe projection |
| `GET` | `/games/:id/authoritative-state` | Inspect trusted canonical state |
| `GET` | `/games/:id/revisions` | List mutation revisions |
| `GET` | `/games/:id/revisions/:number/events` | Inspect durable events for one revision |

Every mutation body includes `expected_revision` and `idempotency_key`. A stale revision returns HTTP 409. Retrying a completed key returns its original result and does not apply the change twice.

WorldPatch references may use persisted IDs or request-local `ref` values. Created-record events return each supplied `ref` with its durable ID. Realm resolves the whole proposed graph, checks references, place connection endpoints, creature actors, single-parent containment, and cycles, then commits state, one revision, and its events in one SQLite transaction.

## Visibility contract

The actor-scoped route is a purpose-built projection:

- Canonical fact text appears only after that actor has fact knowledge. Authoring metadata is omitted, and a subject ID appears only when that entity is also visible.
- Entities appear when marked inherently `player_visible`, explicitly observed by that actor, or when the entity is the actor itself. Their name, description, and properties come from an explicit `player` projection; canonical authoring fields are never serialized by this route. An actor's own name is the only fallback.
- Containment appears only when both ends are visible.
- Connections require an explicit player-visible flag and visible endpoints.
- Learning a fact does not automatically expose its subject entity.
- Revisions, events, game definitions, and the authoritative-state route are trusted surfaces and must not be presented directly to players.

This is deliberately smaller than a general ACL or per-field visibility system.

## Architecture and scope

The service is a modular monolith: Fastify and TypeBox handle JSON/HTTP validation, `RealmService` owns commands and invariants, and `better-sqlite3` owns persistence. SQLite keeps deployment and transaction behavior simple for a single small service. WAL mode, foreign keys, a busy timeout, optimistic revision checks, and short transactions provide an adequate v1 concurrency model. A higher-write deployment can later replace the persistence adapter. Versioned raw SQL migrations keep composite keys and constraints explicit and avoid adding an ORM abstraction before the query model warrants one.

State tables are the current read model. Append-only revision and event tables provide durable historical identity and audit data, but state is not replayed from events. This preserves a path to richer history without requiring event sourcing, rollback, or forks now.

Facts use text, an optional entity subject, and metadata. Entity properties are a constrained JSON extension point. This avoids committing v1 to a universal ontology or component engine while relational tables enforce the invariants the Greyfen scenario needs.

Included now: games, place/creature/item entities, containment, place connections, facts, actor knowledge, observations, atomic WorldPatch, move/reveal/observe/establish/time operations, revisions, events, world time, and isolated game scope.

Deferred: authentication, generic components, factions, situations, beliefs, schedules, portals and locks, ownership, combat, rules and dice, rollback, replay, branching, richer visibility, companion UI, Resident, Keeper, and AI integration.

## Tests

Integration tests use Fastify's HTTP injection against a disposable real SQLite database. The Greyfen flow creates and seeds a game, proves hidden state stays out of an actor projection, reveals knowledge, observes and moves entities, advances time, and inspects revisions/events. Focused assertions cover failed-patch rollback, containment cycles, cross-game references, stale revisions, and idempotent retry.
