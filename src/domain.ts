import type { RealmDatabase } from "./database.js";
import { DomainError, requireValue } from "./errors.js";
import { newId } from "./ids.js";
import type { MutationRequest, MutationResult, StoredEvent, WorldPatch } from "./types.js";

type Row = Record<string, any>;
type PendingEvent = { type: string; payload: Record<string, unknown> };

const json = (value: unknown): string => JSON.stringify(value ?? {});
const parse = <T>(value: string): T => JSON.parse(value) as T;

export class RealmService {
  constructor(private readonly db: RealmDatabase) {}

  createGame(input: { title: string; definition?: Record<string, unknown>; world_time_minutes?: number }) {
    requireValue(input.title?.trim(), "INVALID_TITLE", "title is required");
    const worldTime = input.world_time_minutes ?? 0;
    requireValue(Number.isSafeInteger(worldTime) && worldTime >= 0, "INVALID_WORLD_TIME", "world_time_minutes must be a non-negative integer");
    const game = { id: newId(), title: input.title.trim(), definition: input.definition ?? {}, world_time_minutes: worldTime, current_revision: 0 };
    this.db.prepare("INSERT INTO games(id,title,definition_json,world_time_minutes,current_revision,created_at) VALUES (?,?,?,?,0,?)")
      .run(game.id, game.title, json(game.definition), worldTime, new Date().toISOString());
    return game;
  }

  applyWorldPatch(gameId: string, patch: WorldPatch): MutationResult {
    return this.mutate(gameId, "world_patch", patch, (revision) => {
      const existingEntities = this.db.prepare("SELECT * FROM entities WHERE game_id = ?").all(gameId) as Row[];
      const entityMap = new Map(existingEntities.map((row) => [row.id as string, row]));
      const connectionIds = new Set<string>((this.db.prepare("SELECT id FROM connections WHERE game_id = ?").all(gameId) as Row[]).map((r) => r.id));
      const factIds = new Set<string>((this.db.prepare("SELECT id FROM facts WHERE game_id = ?").all(gameId) as Row[]).map((r) => r.id));
      const aliases = new Map<string, string>();
      const creates = patch.entities ?? [];
      const updates = patch.entity_updates ?? [];
      const containments = patch.containment ?? [];
      const connections = patch.connections ?? [];
      const facts = patch.facts ?? [];
      const knowledge = patch.knowledge ?? [];
      const observations = patch.observations ?? [];
      requireValue(creates.length + updates.length + containments.length + connections.length + facts.length + knowledge.length + observations.length > 0,
        "EMPTY_PATCH", "world patch must contain at least one change");

      for (const entity of creates) {
        requireValue(["place", "creature", "item"].includes(entity.kind), "INVALID_ENTITY_KIND", `unsupported entity kind: ${entity.kind}`);
        requireValue(entity.name?.trim(), "INVALID_ENTITY", "entity name is required");
        const id = entity.id ?? newId();
        entity.id = id;
        requireValue(!entityMap.has(id), "DUPLICATE_ENTITY", `entity already exists: ${id}`);
        entityMap.set(id, { ...entity, id });
      }
      for (const connection of connections) {
        const id = connection.id ?? newId();
        connection.id = id;
        requireValue(!connectionIds.has(id), "DUPLICATE_CONNECTION", `connection already exists: ${id}`);
        connectionIds.add(id);
      }
      for (const fact of facts) {
        const id = fact.id ?? newId();
        fact.id = id;
        requireValue(!factIds.has(id), "DUPLICATE_FACT", `fact already exists: ${id}`);
        factIds.add(id);
      }
      const addressableIds = new Set<string>([...entityMap.keys(), ...connectionIds, ...factIds]);
      for (const item of [...creates, ...connections, ...facts]) {
        if (!item.ref) continue;
        requireValue(!addressableIds.has(item.ref), "REF_ID_COLLISION", `local ref collides with an addressable ID: ${item.ref}`);
        requireValue(!aliases.has(item.ref), "DUPLICATE_REF", `duplicate local ref: ${item.ref}`);
        aliases.set(item.ref, item.id!);
      }
      const resolve = (value: string): string => aliases.get(value) ?? value;
      for (const update of updates) requireValue(entityMap.has(resolve(update.entity_id)), "ENTITY_NOT_FOUND", `entity not found: ${update.entity_id}`, 404);

      const parentByChild = new Map<string, string>();
      for (const row of this.db.prepare("SELECT child_entity_id,parent_entity_id FROM containment WHERE game_id = ?").all(gameId) as Row[])
        parentByChild.set(row.child_entity_id, row.parent_entity_id);
      const patchedChildren = new Set<string>();
      for (const edge of containments) {
        const child = resolve(edge.child_id), parent = resolve(edge.parent_id);
        requireValue(entityMap.has(child), "ENTITY_NOT_FOUND", `containment child not found: ${edge.child_id}`);
        requireValue(entityMap.has(parent), "ENTITY_NOT_FOUND", `containment parent not found: ${edge.parent_id}`);
        requireValue(child !== parent, "CONTAINMENT_CYCLE", "an entity cannot contain itself");
        requireValue(!patchedChildren.has(child), "DUPLICATE_CONTAINMENT", `patch sets more than one parent for ${edge.child_id}`);
        patchedChildren.add(child);
        parentByChild.set(child, parent);
      }
      for (const start of parentByChild.keys()) {
        const seen = new Set<string>();
        let current: string | undefined = start;
        while (current !== undefined) {
          requireValue(!seen.has(current), "CONTAINMENT_CYCLE", `containment would create a cycle involving ${current}`);
          seen.add(current);
          current = parentByChild.get(current);
        }
      }

      for (const connection of connections) {
        const from = entityMap.get(resolve(connection.from_place_id));
        const to = entityMap.get(resolve(connection.to_place_id));
        requireValue(from?.kind === "place" && to?.kind === "place", "INVALID_CONNECTION", "connection endpoints must be places");
        requireValue(resolve(connection.from_place_id) !== resolve(connection.to_place_id), "INVALID_CONNECTION", "connection endpoints must differ");
        requireValue(connection.typical_travel_minutes === undefined || (Number.isSafeInteger(connection.typical_travel_minutes) && connection.typical_travel_minutes >= 0), "INVALID_CONNECTION", "typical_travel_minutes must be a non-negative integer");
      }

      for (const fact of facts) {
        requireValue(fact.text?.trim(), "INVALID_FACT", "fact text is required");
        if (fact.subject_entity_id) requireValue(entityMap.has(resolve(fact.subject_entity_id)), "ENTITY_NOT_FOUND", `fact subject not found: ${fact.subject_entity_id}`);
      }
      for (const item of knowledge) {
        const actor = entityMap.get(resolve(item.actor_id));
        requireValue(actor?.kind === "creature", "INVALID_ACTOR", `knowledge actor must be a creature: ${item.actor_id}`);
        requireValue(factIds.has(resolve(item.fact_id)), "FACT_NOT_FOUND", `fact not found: ${item.fact_id}`, 404);
      }
      for (const item of observations) {
        const actor = entityMap.get(resolve(item.actor_id));
        requireValue(actor?.kind === "creature", "INVALID_ACTOR", `observation actor must be a creature: ${item.actor_id}`);
        requireValue(entityMap.has(resolve(item.entity_id)), "ENTITY_NOT_FOUND", `observed entity not found: ${item.entity_id}`, 404);
      }

      const events: PendingEvent[] = [];
      const insertEntity = this.db.prepare("INSERT INTO entities(game_id,id,kind,name,description,properties_json,player_name,player_description,player_properties_json,player_visible) VALUES (?,?,?,?,?,?,?,?,?,?)");
      for (const entity of creates) {
        const resolvedId = entity.id!;
        insertEntity.run(gameId, resolvedId, entity.kind, entity.name.trim(), entity.description ?? "", json(entity.properties), entity.player?.name ?? null, entity.player?.description ?? null, json(entity.player?.properties), entity.player_visible ? 1 : 0);
        events.push({ type: "EntityCreated", payload: { entity_id: resolvedId, kind: entity.kind, ...(entity.ref ? { ref: entity.ref } : {}) } });
      }
      const updateEntity = this.db.prepare("UPDATE entities SET name=COALESCE(?,name),description=COALESCE(?,description),properties_json=COALESCE(?,properties_json),player_name=COALESCE(?,player_name),player_description=COALESCE(?,player_description),player_properties_json=COALESCE(?,player_properties_json),player_visible=COALESCE(?,player_visible) WHERE game_id=? AND id=?");
      for (const update of updates) {
        const id = resolve(update.entity_id);
        updateEntity.run(update.name ?? null, update.description ?? null, update.properties === undefined ? null : json(update.properties), update.player?.name ?? null, update.player?.description ?? null, update.player?.properties === undefined ? null : json(update.player.properties), update.player_visible === undefined ? null : update.player_visible ? 1 : 0, gameId, id);
        events.push({ type: "EntityUpdated", payload: { entity_id: id } });
      }
      const setParent = this.db.prepare("INSERT INTO containment(game_id,child_entity_id,parent_entity_id) VALUES (?,?,?) ON CONFLICT(game_id,child_entity_id) DO UPDATE SET parent_entity_id=excluded.parent_entity_id");
      for (const edge of containments) {
        const child = resolve(edge.child_id), parent = resolve(edge.parent_id);
        setParent.run(gameId, child, parent);
        events.push({ type: "EntityMoved", payload: { entity_id: child, destination_id: parent } });
      }
      const insertConnection = this.db.prepare("INSERT INTO connections(game_id,id,from_place_id,to_place_id,bidirectional,typical_travel_minutes,player_visible) VALUES (?,?,?,?,?,?,?)");
      for (const c of connections) {
        insertConnection.run(gameId, c.id!, resolve(c.from_place_id), resolve(c.to_place_id), c.bidirectional === false ? 0 : 1, c.typical_travel_minutes ?? null, c.player_visible ? 1 : 0);
        events.push({ type: "ConnectionEstablished", payload: { connection_id: c.id, ...(c.ref ? { ref: c.ref } : {}) } });
      }
      const insertFact = this.db.prepare("INSERT INTO facts(game_id,id,text,subject_entity_id,metadata_json) VALUES (?,?,?,?,?)");
      for (const fact of facts) {
        insertFact.run(gameId, fact.id!, fact.text.trim(), fact.subject_entity_id ? resolve(fact.subject_entity_id) : null, json(fact.metadata));
        events.push({ type: "FactEstablished", payload: { fact_id: fact.id, ...(fact.ref ? { ref: fact.ref } : {}) } });
      }
      for (const item of knowledge) {
        const actor = resolve(item.actor_id), fact = resolve(item.fact_id);
        const result = this.db.prepare("INSERT OR IGNORE INTO fact_knowledge(game_id,actor_entity_id,fact_id,learned_revision) VALUES (?,?,?,?)").run(gameId, actor, fact, revision);
        if (result.changes > 0) events.push({ type: "FactRevealed", payload: { actor_id: actor, fact_id: fact } });
      }
      for (const item of observations) {
        const actor = resolve(item.actor_id), entity = resolve(item.entity_id);
        const result = this.db.prepare("INSERT OR IGNORE INTO entity_observations(game_id,actor_entity_id,entity_id,observed_revision) VALUES (?,?,?,?)").run(gameId, actor, entity, revision);
        if (result.changes > 0) events.push({ type: "EntityObserved", payload: { actor_id: actor, entity_id: entity } });
      }
      return events;
    });
  }

  move(gameId: string, input: MutationRequest & { entity_id: string; destination_id: string }): MutationResult {
    return this.mutate(gameId, "move", input, () => {
      const entity = this.entity(gameId, input.entity_id), destination = this.entity(gameId, input.destination_id);
      requireValue(entity, "ENTITY_NOT_FOUND", `entity not found: ${input.entity_id}`, 404);
      requireValue(destination, "ENTITY_NOT_FOUND", `destination not found: ${input.destination_id}`, 404);
      requireValue(input.entity_id !== input.destination_id, "CONTAINMENT_CYCLE", "an entity cannot contain itself");
      let current: string | undefined = input.destination_id;
      while (current) {
        requireValue(current !== input.entity_id, "CONTAINMENT_CYCLE", "move would create a containment cycle");
        const row = this.db.prepare("SELECT parent_entity_id FROM containment WHERE game_id=? AND child_entity_id=?").get(gameId, current) as Row | undefined;
        current = row?.parent_entity_id;
      }
      this.db.prepare("INSERT INTO containment(game_id,child_entity_id,parent_entity_id) VALUES (?,?,?) ON CONFLICT(game_id,child_entity_id) DO UPDATE SET parent_entity_id=excluded.parent_entity_id").run(gameId, input.entity_id, input.destination_id);
      return [{ type: "EntityMoved", payload: { entity_id: input.entity_id, destination_id: input.destination_id } }];
    });
  }

  revealFact(gameId: string, input: MutationRequest & { actor_id: string; fact_id: string }): MutationResult {
    return this.mutate(gameId, "reveal_fact", input, (revision) => {
      const actor = this.entity(gameId, input.actor_id);
      requireValue(actor?.kind === "creature", "INVALID_ACTOR", "actor must be a creature", 400);
      const fact = this.db.prepare("SELECT 1 FROM facts WHERE game_id=? AND id=?").get(gameId, input.fact_id);
      requireValue(fact, "FACT_NOT_FOUND", `fact not found: ${input.fact_id}`, 404);
      const result = this.db.prepare("INSERT OR IGNORE INTO fact_knowledge(game_id,actor_entity_id,fact_id,learned_revision) VALUES (?,?,?,?)").run(gameId, input.actor_id, input.fact_id, revision);
      return result.changes > 0 ? [{ type: "FactRevealed", payload: { actor_id: input.actor_id, fact_id: input.fact_id } }] : [];
    });
  }

  establishFact(gameId: string, input: MutationRequest & { id?: string; text: string; subject_entity_id?: string; metadata?: Record<string, unknown> }): MutationResult {
    requireValue(input.text?.trim(), "INVALID_FACT", "fact text is required");
    return this.mutate(gameId, "establish_fact", input, () => {
      const factId = input.id ?? newId();
      requireValue(!this.db.prepare("SELECT 1 FROM facts WHERE game_id=? AND id=?").get(gameId, factId), "DUPLICATE_FACT", `fact already exists: ${factId}`);
      if (input.subject_entity_id) requireValue(this.entity(gameId, input.subject_entity_id), "ENTITY_NOT_FOUND", `fact subject not found: ${input.subject_entity_id}`, 404);
      this.db.prepare("INSERT INTO facts(game_id,id,text,subject_entity_id,metadata_json) VALUES (?,?,?,?,?)")
        .run(gameId, factId, input.text.trim(), input.subject_entity_id ?? null, json(input.metadata));
      return [{ type: "FactEstablished", payload: { fact_id: factId } }];
    });
  }

  observeEntity(gameId: string, input: MutationRequest & { actor_id: string; entity_id: string }): MutationResult {
    return this.mutate(gameId, "observe_entity", input, (revision) => {
      const actor = this.entity(gameId, input.actor_id);
      requireValue(actor?.kind === "creature", "INVALID_ACTOR", "actor must be a creature", 400);
      requireValue(this.entity(gameId, input.entity_id), "ENTITY_NOT_FOUND", `entity not found: ${input.entity_id}`, 404);
      const result = this.db.prepare("INSERT OR IGNORE INTO entity_observations(game_id,actor_entity_id,entity_id,observed_revision) VALUES (?,?,?,?)")
        .run(gameId, input.actor_id, input.entity_id, revision);
      return result.changes > 0 ? [{ type: "EntityObserved", payload: { actor_id: input.actor_id, entity_id: input.entity_id } }] : [];
    });
  }

  advanceTime(gameId: string, input: MutationRequest & { minutes: number }): MutationResult {
    requireValue(Number.isSafeInteger(input.minutes) && input.minutes > 0, "INVALID_TIME_ADVANCE", "minutes must be a positive integer");
    return this.mutate(gameId, "advance_time", input, () => {
      const before = (this.game(gameId).world_time_minutes as number);
      const after = before + input.minutes;
      this.db.prepare("UPDATE games SET world_time_minutes=? WHERE id=?").run(after, gameId);
      return [{ type: "TimeAdvanced", payload: { minutes: input.minutes, from: before, to: after } }];
    });
  }

  authoritativeState(gameId: string) {
    const game = this.game(gameId);
    return {
      game: this.mapGame(game),
      entities: (this.db.prepare("SELECT * FROM entities WHERE game_id=? ORDER BY id").all(gameId) as Row[]).map(this.mapEntity),
      containment: this.db.prepare("SELECT child_entity_id,parent_entity_id FROM containment WHERE game_id=? ORDER BY child_entity_id").all(gameId),
      connections: (this.db.prepare("SELECT * FROM connections WHERE game_id=? ORDER BY id").all(gameId) as Row[]).map(this.mapConnection),
      facts: (this.db.prepare("SELECT * FROM facts WHERE game_id=? ORDER BY id").all(gameId) as Row[]).map(this.mapFact),
      knowledge: this.db.prepare("SELECT actor_entity_id,fact_id,learned_revision FROM fact_knowledge WHERE game_id=? ORDER BY actor_entity_id,fact_id").all(gameId),
      observations: this.db.prepare("SELECT actor_entity_id,entity_id,observed_revision FROM entity_observations WHERE game_id=? ORDER BY actor_entity_id,entity_id").all(gameId)
    };
  }

  playerState(gameId: string, actorId: string) {
    const game = this.game(gameId);
    const actor = this.entity(gameId, actorId);
    requireValue(actor?.kind === "creature", "INVALID_ACTOR", "actor must be a creature in this game", 400);
    const rows = this.db.prepare(`SELECT e.* FROM entities e WHERE e.game_id=? AND (e.id=? OR e.player_visible=1 OR EXISTS
      (SELECT 1 FROM entity_observations o WHERE o.game_id=e.game_id AND o.actor_entity_id=? AND o.entity_id=e.id)) ORDER BY e.id`).all(gameId, actorId, actorId) as Row[];
    const visible = new Set(rows.map((row) => row.id as string));
    return {
      game: { id: game.id, title: game.title, world_time_minutes: game.world_time_minutes },
      actor_id: actorId,
      entities: rows.map((row) => this.mapPlayerEntity(row, actorId)),
      containment: (this.db.prepare("SELECT child_entity_id,parent_entity_id FROM containment WHERE game_id=?").all(gameId) as Row[])
        .filter((row) => visible.has(row.child_entity_id) && visible.has(row.parent_entity_id)),
      connections: (this.db.prepare("SELECT * FROM connections WHERE game_id=? AND player_visible=1 ORDER BY id").all(gameId) as Row[])
        .filter((row) => visible.has(row.from_place_id) && visible.has(row.to_place_id)).map(this.mapConnection),
      facts: (this.db.prepare(`SELECT f.* FROM facts f JOIN fact_knowledge k ON k.game_id=f.game_id AND k.fact_id=f.id
        WHERE f.game_id=? AND k.actor_entity_id=? ORDER BY f.id`).all(gameId, actorId) as Row[])
        .map((row) => ({ id: row.id, text: row.text, subject_entity_id: row.subject_entity_id && visible.has(row.subject_entity_id) ? row.subject_entity_id : null }))
    };
  }

  revisions(gameId: string) {
    this.game(gameId);
    return (this.db.prepare("SELECT revision_number,id,mutation_kind,idempotency_key,created_at,metadata_json FROM revisions WHERE game_id=? ORDER BY revision_number").all(gameId) as Row[])
      .map((r) => ({ ...r, metadata: parse(r.metadata_json), metadata_json: undefined }));
  }

  events(gameId: string, revision: number) {
    this.game(gameId);
    const exists = this.db.prepare("SELECT 1 FROM revisions WHERE game_id=? AND revision_number=?").get(gameId, revision);
    requireValue(exists, "REVISION_NOT_FOUND", `revision not found: ${revision}`, 404);
    return (this.db.prepare("SELECT ordinal,type,payload_json,created_at FROM events WHERE game_id=? AND revision_number=? ORDER BY ordinal").all(gameId, revision) as Row[])
      .map((r) => ({ ordinal: r.ordinal, type: r.type, payload: parse(r.payload_json), created_at: r.created_at }));
  }

  private mutate(gameId: string, kind: string, request: MutationRequest, change: (revision: number) => PendingEvent[]): MutationResult {
    requireValue(Number.isSafeInteger(request.expected_revision) && request.expected_revision >= 0, "INVALID_EXPECTED_REVISION", "expected_revision must be a non-negative integer");
    requireValue(typeof request.idempotency_key === "string" && request.idempotency_key.trim().length > 0, "INVALID_IDEMPOTENCY_KEY", "idempotency_key is required");
    const transaction = this.db.transaction(() => {
      const game = this.game(gameId);
      const previous = this.db.prepare("SELECT revision_number,id FROM revisions WHERE game_id=? AND idempotency_key=?").get(gameId, request.idempotency_key) as Row | undefined;
      if (previous) return this.mutationResult(gameId, previous.revision_number, previous.id, true);
      requireValue(game.current_revision === request.expected_revision, "REVISION_CONFLICT", `expected revision ${request.expected_revision}, current revision is ${game.current_revision}`, 409);
      const revision = game.current_revision + 1;
      const revisionId = newId(), now = new Date().toISOString();
      const events = change(revision);
      if (events.length === 0) {
        const current = this.db.prepare("SELECT id FROM revisions WHERE game_id=? AND revision_number=?").get(gameId, game.current_revision) as Row;
        return { revision: game.current_revision, revision_id: current.id, events: [], idempotent: false };
      }
      this.db.prepare("INSERT INTO revisions(game_id,revision_number,id,mutation_kind,idempotency_key,created_at,metadata_json) VALUES (?,?,?,?,?,?,?)")
        .run(gameId, revision, revisionId, kind, request.idempotency_key, now, "{}");
      const insertEvent = this.db.prepare("INSERT INTO events(game_id,revision_number,ordinal,type,payload_json,created_at) VALUES (?,?,?,?,?,?)");
      events.forEach((event, ordinal) => insertEvent.run(gameId, revision, ordinal, event.type, json(event.payload), now));
      this.db.prepare("UPDATE games SET current_revision=? WHERE id=?").run(revision, gameId);
      return this.mutationResult(gameId, revision, revisionId, false);
    });
    return transaction();
  }

  private mutationResult(gameId: string, revision: number, revisionId: string, idempotent: boolean): MutationResult {
    const events = (this.db.prepare("SELECT ordinal,type,payload_json FROM events WHERE game_id=? AND revision_number=? ORDER BY ordinal").all(gameId, revision) as Row[])
      .map((row): StoredEvent => ({ ordinal: row.ordinal, type: row.type, payload: parse(row.payload_json) }));
    return { revision, revision_id: revisionId, events, idempotent };
  }
  private game(id: string): Row {
    const row = this.db.prepare("SELECT * FROM games WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new DomainError(404, "GAME_NOT_FOUND", `game not found: ${id}`);
    return row;
  }
  private entity(gameId: string, id: string): Row | undefined { return this.db.prepare("SELECT * FROM entities WHERE game_id=? AND id=?").get(gameId, id) as Row | undefined; }
  private mapGame = (r: Row) => ({ id: r.id, title: r.title, definition: parse(r.definition_json), world_time_minutes: r.world_time_minutes, current_revision: r.current_revision, created_at: r.created_at });
  private mapEntity = (r: Row) => ({ id: r.id, kind: r.kind, name: r.name, description: r.description, properties: parse(r.properties_json), player_projection: { name: r.player_name, description: r.player_description, properties: parse(r.player_properties_json) }, player_visible: Boolean(r.player_visible) });
  private mapPlayerEntity = (r: Row, actorId: string) => ({ id: r.id, kind: r.kind, name: r.player_name ?? (r.id === actorId ? r.name : null), description: r.player_description, properties: parse(r.player_properties_json) });
  private mapConnection = (r: Row) => ({ id: r.id, from_place_id: r.from_place_id, to_place_id: r.to_place_id, bidirectional: Boolean(r.bidirectional), typical_travel_minutes: r.typical_travel_minutes, player_visible: Boolean(r.player_visible) });
  private mapFact = (r: Row) => ({ id: r.id, text: r.text, subject_entity_id: r.subject_entity_id, metadata: parse(r.metadata_json) });
}
