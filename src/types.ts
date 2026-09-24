export type EntityKind = "place" | "creature" | "item";

export interface EntityInput {
  id?: string;
  ref?: string;
  kind: EntityKind;
  name: string;
  description?: string;
  appearance?: string;
  properties?: Record<string, unknown>;
  player?: { name?: string; description?: string; properties?: Record<string, unknown> };
  player_visible?: boolean;
}

export interface EntityUpdate {
  entity_id: string;
  name?: string;
  description?: string;
  appearance?: string;
  properties?: Record<string, unknown>;
  player?: { name?: string; description?: string; properties?: Record<string, unknown> };
  player_visible?: boolean;
}

export interface ContainmentInput { child_id: string; parent_id: string }
export interface ConnectionInput {
  id?: string;
  ref?: string;
  from_place_id: string;
  to_place_id: string;
  bidirectional?: boolean;
  typical_travel_minutes?: number;
  player_visible?: boolean;
}
export interface FactInput {
  id?: string;
  ref?: string;
  text: string;
  subject_entity_id?: string;
  metadata?: Record<string, unknown>;
}
export interface KnowledgeInput { actor_id: string; fact_id: string }
export interface ObservationInput { actor_id: string; entity_id: string }

export interface MutationRequest { expected_revision: number; idempotency_key: string }
export type RuntimeChange =
  | { type: "move"; entity_id: string; destination_id: string }
  | { type: "establish_fact"; id?: string; text: string; subject_entity_id?: string; metadata?: Record<string, unknown> }
  | { type: "reveal_fact"; actor_id: string; fact_id: string }
  | { type: "observe_entity"; actor_id: string; entity_id: string }
  | { type: "advance_time"; minutes: number };
export interface RuntimeBatch extends MutationRequest { changes: RuntimeChange[] }
export interface WorldPatch extends MutationRequest {
  entities?: EntityInput[];
  entity_updates?: EntityUpdate[];
  containment?: ContainmentInput[];
  connections?: ConnectionInput[];
  facts?: FactInput[];
  knowledge?: KnowledgeInput[];
  observations?: ObservationInput[];
}

export interface StoredEvent { ordinal: number; type: string; payload: Record<string, unknown> }
export interface MutationResult {
  revision: number; revision_id: string; events: StoredEvent[]; idempotent: boolean;
  world_time_minutes?: number;
  created_facts?: { change_index: number; fact_id: string }[];
}
