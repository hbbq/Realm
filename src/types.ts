export type EntityKind = "place" | "creature" | "item";

export interface EntityInput {
  id?: string;
  ref?: string;
  kind: EntityKind;
  name: string;
  description?: string;
  properties?: Record<string, unknown>;
  player?: { name?: string; description?: string; properties?: Record<string, unknown> };
  player_visible?: boolean;
}

export interface EntityUpdate {
  entity_id: string;
  name?: string;
  description?: string;
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
export interface MutationResult { revision: number; revision_id: string; events: StoredEvent[]; idempotent: boolean }
