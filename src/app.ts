import Fastify, { type FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { RealmDatabase } from "./database.js";
import { DomainError } from "./errors.js";
import { RealmService } from "./domain.js";

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
  description: Type.Optional(Type.String()), properties: Type.Optional(JsonObject),
  player: Type.Optional(Type.Object({ name: Type.Optional(Type.String()), description: Type.Optional(Type.String()), properties: Type.Optional(JsonObject) }, { additionalProperties: false })),
  player_visible: Type.Optional(Type.Boolean())
}, { additionalProperties: false });
const WorldPatchSchema = Type.Object({
  ...Mutation,
  entities: Type.Optional(Type.Array(Entity)),
  entity_updates: Type.Optional(Type.Array(Type.Object({ entity_id: Id, name: Type.Optional(Type.String({ minLength: 1 })), description: Type.Optional(Type.String()), properties: Type.Optional(JsonObject), player: Type.Optional(Type.Object({ name: Type.Optional(Type.String()), description: Type.Optional(Type.String()), properties: Type.Optional(JsonObject) }, { additionalProperties: false })), player_visible: Type.Optional(Type.Boolean()) }, { additionalProperties: false }))),
  containment: Type.Optional(Type.Array(Type.Object({ child_id: Id, parent_id: Id }, { additionalProperties: false }))),
  connections: Type.Optional(Type.Array(Type.Object({ id: Type.Optional(Id), ref: Type.Optional(Id), from_place_id: Id, to_place_id: Id, bidirectional: Type.Optional(Type.Boolean()), typical_travel_minutes: Type.Optional(Type.Integer({ minimum: 0 })), player_visible: Type.Optional(Type.Boolean()) }, { additionalProperties: false }))),
  facts: Type.Optional(Type.Array(Type.Object({ id: Type.Optional(Id), ref: Type.Optional(Id), text: Type.String({ minLength: 1 }), subject_entity_id: Type.Optional(Id), metadata: Type.Optional(JsonObject) }, { additionalProperties: false }))),
  knowledge: Type.Optional(Type.Array(Type.Object({ actor_id: Id, fact_id: Id }, { additionalProperties: false }))),
  observations: Type.Optional(Type.Array(Type.Object({ actor_id: Id, entity_id: Id }, { additionalProperties: false })))
}, { additionalProperties: false });

export function buildApp(db: RealmDatabase): FastifyInstance {
  const app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
  const realm = new RealmService(db);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    if (error.validation) return reply.status(400).send({ error: "INVALID_REQUEST", message: error.message });
    app.log.error(error);
    return reply.status(500).send({ error: "INTERNAL_ERROR", message: "internal server error" });
  });

  app.get("/health", async () => ({ status: "ok" }));
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

  app.get("/games/:gameId/state", { schema: { params: GameParams, querystring: Type.Object({ actor_id: Id }, { additionalProperties: false }) } }, async (r) => realm.playerState(r.params.gameId, r.query.actor_id));
  app.get("/games/:gameId/authoritative-state", { schema: { params: GameParams } }, async (r) => realm.authoritativeState(r.params.gameId));
  app.get("/games/:gameId/revisions", { schema: { params: GameParams } }, async (r) => realm.revisions(r.params.gameId));
  app.get("/games/:gameId/revisions/:revision/events", { schema: { params: Type.Object({ gameId: Id, revision: Type.Integer({ minimum: 1 })) } } }, async (r) => realm.events(r.params.gameId, r.params.revision));
  return app;
}
