CREATE TABLE entity_illustrations (
  game_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','illustrated','skipped','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  lease_until TEXT,
  next_retry_at TEXT,
  reason TEXT,
  asset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (game_id, entity_id),
  FOREIGN KEY (game_id, entity_id) REFERENCES entities(game_id, id) ON DELETE CASCADE
);
CREATE TABLE illustration_assets (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png','image/webp','image/jpeg')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (game_id, entity_id) REFERENCES entity_illustrations(game_id, entity_id) ON DELETE CASCADE
);
CREATE INDEX illustration_work_idx ON entity_illustrations(status, next_retry_at, lease_until);
