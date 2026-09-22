CREATE TABLE games (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  definition_json TEXT NOT NULL DEFAULT '{}',
  world_time_minutes INTEGER NOT NULL DEFAULT 0 CHECK (world_time_minutes >= 0),
  current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE entities (
  game_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('place', 'creature', 'item')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  properties_json TEXT NOT NULL DEFAULT '{}',
  player_name TEXT,
  player_description TEXT,
  player_properties_json TEXT NOT NULL DEFAULT '{}',
  player_visible INTEGER NOT NULL DEFAULT 0 CHECK (player_visible IN (0, 1)),
  PRIMARY KEY (game_id, id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE TABLE containment (
  game_id TEXT NOT NULL,
  child_entity_id TEXT NOT NULL,
  parent_entity_id TEXT NOT NULL,
  PRIMARY KEY (game_id, child_entity_id),
  FOREIGN KEY (game_id, child_entity_id) REFERENCES entities(game_id, id) ON DELETE CASCADE,
  FOREIGN KEY (game_id, parent_entity_id) REFERENCES entities(game_id, id) ON DELETE CASCADE,
  CHECK (child_entity_id <> parent_entity_id)
);

CREATE TABLE connections (
  game_id TEXT NOT NULL,
  id TEXT NOT NULL,
  from_place_id TEXT NOT NULL,
  to_place_id TEXT NOT NULL,
  bidirectional INTEGER NOT NULL CHECK (bidirectional IN (0, 1)),
  typical_travel_minutes INTEGER CHECK (typical_travel_minutes IS NULL OR typical_travel_minutes >= 0),
  player_visible INTEGER NOT NULL DEFAULT 0 CHECK (player_visible IN (0, 1)),
  PRIMARY KEY (game_id, id),
  FOREIGN KEY (game_id, from_place_id) REFERENCES entities(game_id, id) ON DELETE CASCADE,
  FOREIGN KEY (game_id, to_place_id) REFERENCES entities(game_id, id) ON DELETE CASCADE,
  CHECK (from_place_id <> to_place_id)
);

CREATE TABLE facts (
  game_id TEXT NOT NULL,
  id TEXT NOT NULL,
  text TEXT NOT NULL,
  subject_entity_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (game_id, id),
  FOREIGN KEY (game_id, subject_entity_id) REFERENCES entities(game_id, id) ON DELETE CASCADE
);

CREATE TABLE fact_knowledge (
  game_id TEXT NOT NULL,
  actor_entity_id TEXT NOT NULL,
  fact_id TEXT NOT NULL,
  learned_revision INTEGER NOT NULL,
  PRIMARY KEY (game_id, actor_entity_id, fact_id),
  FOREIGN KEY (game_id, actor_entity_id) REFERENCES entities(game_id, id) ON DELETE CASCADE,
  FOREIGN KEY (game_id, fact_id) REFERENCES facts(game_id, id) ON DELETE CASCADE
);

CREATE TABLE entity_observations (
  game_id TEXT NOT NULL,
  actor_entity_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  observed_revision INTEGER NOT NULL,
  PRIMARY KEY (game_id, actor_entity_id, entity_id),
  FOREIGN KEY (game_id, actor_entity_id) REFERENCES entities(game_id, id) ON DELETE CASCADE,
  FOREIGN KEY (game_id, entity_id) REFERENCES entities(game_id, id) ON DELETE CASCADE
);

CREATE TABLE revisions (
  game_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  id TEXT NOT NULL,
  mutation_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (game_id, revision_number),
  UNIQUE (game_id, id),
  UNIQUE (game_id, idempotency_key),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE TABLE events (
  game_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (game_id, revision_number, ordinal),
  FOREIGN KEY (game_id, revision_number) REFERENCES revisions(game_id, revision_number) ON DELETE CASCADE
);

CREATE INDEX containment_parent_idx ON containment(game_id, parent_entity_id);
CREATE INDEX fact_knowledge_actor_idx ON fact_knowledge(game_id, actor_entity_id);
CREATE INDEX observations_actor_idx ON entity_observations(game_id, actor_entity_id);
