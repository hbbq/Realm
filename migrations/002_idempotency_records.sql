CREATE TABLE idempotency_records (
  game_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  mutation_kind TEXT NOT NULL,
  request_fingerprint TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (game_id, idempotency_key),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Existing revision keys predate request fingerprints. Keep them reserved so
-- they cannot accidentally be reused for a different request after upgrade.
INSERT INTO idempotency_records(game_id,idempotency_key,mutation_kind,created_at)
SELECT game_id,idempotency_key,mutation_kind,created_at FROM revisions;
