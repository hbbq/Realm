import Fastify, { type FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { RealmDatabase } from "./database.js";
import { DomainError } from "./errors.js";
import { RealmService } from "./domain.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IllustrationService, openAiIllustrator, openAiImageGenerator } from "./illustrations.js";

const Id = Type.String({ minLength: 1, maxLength: 200 });
const JsonObject = Type.Record(Type.String(), Type.Unknown());
const Mutation = {
  expected_revision: Type.Integer({ minimum: 0 }),
  idempotency_key: Type.String({ minLength: 1, maxLength: 200 })
};
const GameParams = Type.Object({ gameId: Id });

const Entity = Type.Object({
  id: Type.Optional(Id), ref: Type.Optional(Id),
  kind: Type.Union([Type.Literal("place"), Type.Literal("creature"), Type.Literal("item")]),
  name: Type.String({ minLength: 1, maxLength: 500 }),
  description: Type.Optional(Type.String()), appearance: Type.Optional(Type.String()), properties: Type.Optional(JsonObject),
  player: Type.Optional(Type.Object({ name: Type.Optional(Type.String()), description: Type.Optional(Type.String()), properties: Type.Optional(JsonObject) }, { additionalProperties: false })),
  player_visible: Type.Optional(Type.Boolean())
}, { additionalProperties: false });
const WorldPatchSchema = Type.Object({
  ...Mutation,
  entities: Type.Optional(Type.Array(Entity)),
  entity_updates: Type.Optional(Type.Array(Type.Object({ entity_id: Id, name: Type.Optional(Type.String({ minLength: 1 })), description: Type.Optional(Type.String()), appearance: Type.Optional(Type.String()), properties: Type.Optional(JsonObject), player: Type.Optional(Type.Object({ name: Type.Optional(Type.String()), description: Type.Optional(Type.String()), properties: Type.Optional(JsonObject) }, { additionalProperties: false })), player_visible: Type.Optional(Type.Boolean()) }, { additionalProperties: false }))),
  containment: Type.Optional(Type.Array(Type.Object({ child_id: Id, parent_id: Id }, { additionalProperties: false }))),
  connections: Type.Optional(Type.Array(Type.Object({ id: Type.Optional(Id), ref: Type.Optional(Id), from_place_id: Id, to_place_id: Id, bidirectional: Type.Optional(Type.Boolean()), typical_travel_minutes: Type.Optional(Type.Integer({ minimum: 0 })), player_visible: Type.Optional(Type.Boolean()) }, { additionalProperties: false }))),
  facts: Type.Optional(Type.Array(Type.Object({ id: Type.Optional(Id), ref: Type.Optional(Id), text: Type.String({ minLength: 1 }), subject_entity_id: Type.Optional(Id), metadata: Type.Optional(JsonObject) }, { additionalProperties: false }))),
  knowledge: Type.Optional(Type.Array(Type.Object({ actor_id: Id, fact_id: Id }, { additionalProperties: false }))),
  observations: Type.Optional(Type.Array(Type.Object({ actor_id: Id, entity_id: Id }, { additionalProperties: false })))
}, { additionalProperties: false });

export function buildApp(db: RealmDatabase, assetDir = process.env.REALM_ILLUSTRATION_DIR ?? "illustrations"): FastifyInstance {
  const app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
  const realm = new RealmService(db);
  const illustrations = new IllustrationService(db, assetDir, openAiIllustrator(process.env.OPENAI_API_KEY ?? ""), openAiImageGenerator(process.env.OPENAI_API_KEY ?? ""));

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    if (error instanceof Error && "validation" in error && error.validation) return reply.status(400).send({ error: "INVALID_REQUEST", message: error.message });
    app.log.error(error);
    return reply.status(500).send({ error: "INTERNAL_ERROR", message: "internal server error" });
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/companion", async (_request, reply) => reply.type("text/html; charset=utf-8")
    .send(readFileSync(join(process.cwd(), "web", "companion.html"), "utf8")));
  app.get("/companion-map.js", async (_request, reply) => reply.type("text/javascript; charset=utf-8")
    .send(readFileSync(join(process.cwd(), "web", "companion-map.js"), "utf8")));
  app.get("/games", async () => realm.games());
  app.post("/games", { schema: { body: Type.Object({ title: Type.String({ minLength: 1 }), definition: Type.Optional(JsonObject), world_time_minutes: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false }) } }, async (request, reply) => reply.status(201).send(realm.createGame(request.body)));
  app.post("/games/:gameId/world-patches", { schema: { params: GameParams, body: WorldPatchSchema } }, async (request, reply) => reply.status(201).send(realm.applyWorldPatch(request.params.gameId, request.body as Static<typeof WorldPatchSchema>)));

  const Move = Type.Object({ ...Mutation, entity_id: Id, destination_id: Id }, { additionalProperties: false });
  app.post("/games/:gameId/operations/move", { schema: { params: GameParams, body: Move } }, async (r) => realm.move(r.params.gameId, r.body));
  const Advance = Type.Object({ ...Mutation, minutes: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });
  app.post("/games/:gameId/operations/advance-time", { schema: { params: GameParams, body: Advance } }, async (r) => realm.advanceTime(r.params.gameId, r.body));
  const Reveal = Type.Object({ ...Mutation, actor_id: Id, fact_id: Id }, { additionalProperties: false });
  app.post("/games/:gameId/operations/reveal-fact", { schema: { params: GameParams, body: Reveal } }, async (r) => realm.revealFact(r.params.gameId, r.body));
  const Observe = Type.Object({ ...Mutation, actor_id: Id, entity_id: Id }, { additionalProperties: false });
  app.post("/games/:gameId/operations/observe-entity", { schema: { params: GameParams, body: Observe } }, async (r) => realm.observeEntity(r.params.gameId, r.body));
  const Establish = Type.Object({ ...Mutation, id: Type.Optional(Id), text: Type.String({ minLength: 1 }), subject_entity_id: Type.Optional(Id), metadata: Type.Optional(JsonObject) }, { additionalProperties: false });
  app.post("/games/:gameId/operations/establish-fact", { schema: { params: GameParams, body: Establish } }, async (r) => realm.establishFact(r.params.gameId, r.body));
  const RuntimeChange = Type.Union([
    Type.Object({ type: Type.Literal("move"), entity_id: Id, destination_id: Id }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal("establish_fact"), id: Type.Optional(Id), text: Type.String({ minLength: 1 }), subject_entity_id: Type.Optional(Id), metadata: Type.Optional(JsonObject) }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal("reveal_fact"), actor_id: Id, fact_id: Id }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal("observe_entity"), actor_id: Id, entity_id: Id }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal("advance_time"), minutes: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })
  ]);
  const RuntimeBatch = Type.Object({ ...Mutation, changes: Type.Array(RuntimeChange, { minItems: 1, maxItems: 100 }) }, { additionalProperties: false });
  app.post("/games/:gameId/operations/batch", { schema: { params: GameParams, body: RuntimeBatch } }, async (r) => realm.applyRuntimeBatch(r.params.gameId, r.body));

  app.get("/games/:gameId/state", { schema: { params: GameParams, querystring: Type.Object({ actor_id: Id }, { additionalProperties: false }) } }, async (r) => {
    const state = realm.playerState(r.params.gameId, r.query.actor_id);
    return { ...state, entities: state.entities.map((entity) => ({ ...entity,
      illustration: (() => { const metadata = illustrations.metadata(r.params.gameId, entity.id); return metadata.status === "illustrated"
        ? { status: metadata.status, url: `/games/${encodeURIComponent(r.params.gameId)}/entities/${encodeURIComponent(entity.id)}/illustration?actor_id=${encodeURIComponent(r.query.actor_id)}` }
        : { status: metadata.status }; })() })) };
  });
  app.get("/games/:gameId/authoritative-state", { schema: { params: GameParams } }, async (r) => {
    const state = realm.authoritativeState(r.params.gameId);
    return { ...state, entities: state.entities.map((entity) => {
      const metadata = illustrations.metadata(r.params.gameId, entity.id);
      return { ...entity, illustration: metadata.status === "illustrated"
        ? { ...metadata, url: `/games/${encodeURIComponent(r.params.gameId)}/entities/${encodeURIComponent(entity.id)}/authoritative-illustration` }
        : metadata };
    }) };
  });
  app.get("/games/:gameId/entities/:entityId/illustration", { schema: { params: Type.Object({ gameId: Id, entityId: Id }), querystring: Type.Object({ actor_id: Id }, { additionalProperties: false }) } },
    async (r, reply) => reply.type("image/png").header("Cache-Control", "private, no-store")
      .send(await illustrations.image(r.params.gameId, r.params.entityId, r.query.actor_id)));
  app.get("/games/:gameId/entities/:entityId/authoritative-illustration", { schema: { params: Type.Object({ gameId: Id, entityId: Id }) } },
    async (r, reply) => reply.type("image/png").header("Cache-Control", "private, no-store")
      .send(await illustrations.authoritativeImage(r.params.gameId, r.params.entityId)));
  app.get("/games/:gameId/revisions", { schema: { params: GameParams } }, async (r) => realm.revisions(r.params.gameId));
  app.get("/games/:gameId/revisions/:revision/events", { schema: { params: Type.Object({ gameId: Id, revision: Type.Integer({ minimum: 1 }) }) } }, async (r) => realm.events(r.params.gameId, r.params.revision));
  return app;
}
