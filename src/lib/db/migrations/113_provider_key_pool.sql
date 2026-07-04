-- 113_provider_key_pool.sql
-- Per-provider reserve API key pool. Reserve keys live here plaintext
-- (self-hosted, 1-2 operator model — mirrors the 9router keyPool design).
-- Pulled into provider_connections on demand (manual "Pull from pool" or
-- auto-replace when an active apikey connection hits a quota/credits-exhausted
-- error). provider_specific_data is preserved per key (JSON in `data`) so
-- OpenAI/Anthropic-compatible nodes keep their baseUrl when promoted.
--
-- `key` is stored plaintext on purpose: the pool is a reserve the operator
-- pastes in for their own self-hosted instance. AES-256-GCM field encryption
-- applies only to provider_connections credential fields (see encryption.ts);
-- the pool is a staging area, promotion copies the value into a connection row
-- where it is then encrypted at rest.

CREATE TABLE IF NOT EXISTS key_pool (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT,
  key TEXT NOT NULL,
  data TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kp_provider ON key_pool(provider);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kp_provider_key ON key_pool(provider, key);
