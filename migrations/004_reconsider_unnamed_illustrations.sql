UPDATE entity_illustrations
SET status = 'pending', attempts = 0, reason = NULL, next_retry_at = NULL,
    claim_token = NULL, lease_until = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'skipped' AND reason = 'No player-facing name';
