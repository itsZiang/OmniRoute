/**
 * db/keyPool.ts — Per-provider reserve API key pool.
 *
 * Reserve keys live here plaintext (self-hosted, 1-2 operator model — mirrors
 * the 9router keyPool design). On a quota/credits-exhausted upstream error,
 * `autoReplaceFromPool` (src/sse/services/keyPoolAutoReplace.ts) pulls one key
 * from the pool, promotes it into a `provider_connections` row (auth_type=
 * "apikey", inheriting `providerSpecificData.baseUrl` so compatible nodes still
 * route correctly), and disables the failing connection. Operators can also
 * pull/push manually via `/api/providers/[id]/pool/{pull,push}`.
 *
 * Promotion copies the plaintext pool key into a connection row, where it is
 * then encrypted at rest by `encryptConnectionFields` (see encryption.ts).
 */

import { v4 as uuidv4 } from "uuid";
import { getDbInstance, rowToCamel, cleanNulls } from "./core";
import { backupDbFile } from "./backup";
import { invalidateDbCache } from "./readCache";
import {
  createProviderConnection,
  getProviderConnectionById,
  deleteProviderConnection,
} from "./providers";

type JsonRecord = Record<string, unknown>;

interface StatementLike<TRow = unknown> {
  all: (...params: unknown[]) => TRow[];
  get: (...params: unknown[]) => TRow | undefined;
  run: (...params: unknown[]) => { changes?: number };
}

interface DbLike {
  prepare: <TRow = unknown>(sql: string) => StatementLike<TRow>;
  transaction: <T>(fn: () => T) => () => T;
}

export interface PoolKey {
  id: string;
  provider: string;
  name: string | null;
  key: string;
  providerSpecificData: Record<string, unknown> | null;
  createdAt: string;
}

export interface PoolKeyInput {
  name?: string | null;
  key: string;
  providerSpecificData?: Record<string, unknown> | null;
}

function rowToPoolKey(row: unknown): PoolKey {
  const camelRow = rowToCamel(row);
  const record = cleanNulls(camelRow) as Record<string, unknown>;
  let providerSpecificData: Record<string, unknown> | null = null;
  const raw = typeof record.data === "string" && record.data.length > 0 ? record.data : null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        providerSpecificData = parsed as Record<string, unknown>;
      }
    } catch {
      providerSpecificData = null;
    }
  }
  return {
    id: typeof record.id === "string" ? record.id : "",
    provider: typeof record.provider === "string" ? record.provider : "",
    name: typeof record.name === "string" ? record.name : null,
    key: typeof record.key === "string" ? record.key : "",
    providerSpecificData,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
  };
}

// ──────────────── Read ────────────────

export async function getPoolKeys(provider: string): Promise<PoolKey[]> {
  const db = getDbInstance() as unknown as DbLike;
  const rows = db
    .prepare("SELECT * FROM key_pool WHERE provider = ? ORDER BY created_at ASC")
    .all(provider);
  return rows.map(rowToPoolKey);
}

export async function getPoolKeysPaged(
  provider: string,
  limit = 50,
  offset = 0
): Promise<PoolKey[]> {
  const db = getDbInstance() as unknown as DbLike;
  const rows = db
    .prepare("SELECT * FROM key_pool WHERE provider = ? ORDER BY created_at ASC LIMIT ? OFFSET ?")
    .all(provider, limit, offset);
  return rows.map(rowToPoolKey);
}

export async function getPoolCount(provider: string): Promise<number> {
  const db = getDbInstance() as unknown as DbLike;
  const row = db
    .prepare("SELECT COUNT(*) as cnt FROM key_pool WHERE provider = ?")
    .get(provider) as { cnt?: number } | undefined;
  return row?.cnt ?? 0;
}

// ──────────────── Write ────────────────

export interface AddKeysResult {
  added: number;
  skipped: number;
}

/**
 * Bulk-insert keys into the pool. Dedupes against keys already present
 * (UNIQUE(provider, key) also enforces this at the DB level). Returns the
 * number of newly inserted rows and rows skipped (already present).
 */
export async function addKeysToPool(
  provider: string,
  keys: PoolKeyInput[]
): Promise<AddKeysResult> {
  if (keys.length === 0) return { added: 0, skipped: 0 };
  const db = getDbInstance() as unknown as DbLike;
  const now = new Date().toISOString();
  let added = 0;
  let skipped = 0;
  for (const k of keys) {
    const cleanKey = typeof k.key === "string" ? k.key.trim() : "";
    if (!cleanKey) {
      skipped++;
      continue;
    }
    let dataJson: string | null = null;
    if (k.providerSpecificData && Object.keys(k.providerSpecificData).length > 0) {
      dataJson = JSON.stringify(k.providerSpecificData);
    }
    try {
      const res = db
        .prepare(
          `INSERT INTO key_pool (id, provider, name, key, data, created_at) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(uuidv4(), provider, k.name || null, cleanKey, dataJson, now);
      if (res.changes && res.changes > 0) added++;
      else skipped++;
    } catch {
      // UNIQUE(provider, key) violation or other constraint → already present.
      skipped++;
    }
  }
  backupDbFile("pre-write");
  return { added, skipped };
}

export async function removeKeyFromPool(id: string): Promise<boolean> {
  const db = getDbInstance() as unknown as DbLike;
  const res = db.prepare("DELETE FROM key_pool WHERE id = ?").run(id);
  if (res.changes && res.changes > 0) {
    backupDbFile("pre-write");
    return true;
  }
  return false;
}

/**
 * FIFO pop: fetch up to `n` keys for `provider`, skipping any whose plaintext
 * already matches an existing active-connection key (`existingKeys`). Deletes
 * the popped rows from the pool inside a transaction. Returns the popped keys.
 */
export async function pullKeysFromPool(
  provider: string,
  n: number,
  existingKeys: string[] = []
): Promise<PoolKey[]> {
  if (n <= 0) return [];
  const db = getDbInstance() as unknown as DbLike;
  const existingSet = new Set(existingKeys.map((k) => (typeof k === "string" ? k.trim() : "")));
  return db.transaction(() => {
    const rows = db
      .prepare("SELECT * FROM key_pool WHERE provider = ? ORDER BY created_at ASC")
      .all(provider);
    const popped: PoolKey[] = [];
    const deleteStmt = db.prepare("DELETE FROM key_pool WHERE id = ?");
    for (const row of rows) {
      if (popped.length >= n) break;
      const key = rowToPoolKey(row);
      if (existingSet.has(key.key)) continue;
      deleteStmt.run(key.id);
      popped.push(key);
    }
    return popped;
  })();
}

// ──────────────── Promotion to / from provider_connections ────────────────

/**
 * Promote `pulled` pool keys into real provider_connections rows. Each created
 * connection gets auth_type="apikey" and inherits `inheritPsd`
 * (providerSpecificData — typically `baseUrl` for OpenAI/Anthropic-compatible
 * nodes) so custom endpoints keep routing correctly. Returns the number of
 * connections actually created (may be 0 if every pulled key already existed
 * as a connection via dedup).
 */
export async function createPoolConnections(
  provider: string,
  pulled: PoolKey[],
  existingConnectionKeys: string[] = [],
  inheritPsd: Record<string, unknown> | null = null
): Promise<number> {
  if (pulled.length === 0) return 0;
  const existingSet = new Set(
    existingConnectionKeys.map((k) => (typeof k === "string" ? k.trim() : ""))
  );
  let created = 0;
  for (const k of pulled) {
    if (existingSet.has(k.key)) continue;
    const providerSpecificData =
      k.providerSpecificData && Object.keys(k.providerSpecificData).length > 0
        ? { ...(inheritPsd || {}), ...k.providerSpecificData }
        : inheritPsd;
    await createProviderConnection({
      provider,
      authType: "apikey",
      name: k.name || null,
      apiKey: k.key,
      providerSpecificData,
      isActive: true,
    });
    created++;
  }
  invalidateDbCache("connections");
  return created;
}

/**
 * Move existing apikey-type connections back into the pool (inserts the
 * decrypted apiKey as a pool row, then deletes the connection). Non-apikey
 * connections are skipped (no plaintext apikey to recover). Returns the
 * number of connections actually moved.
 */
export async function moveConnectionsToPool(
  provider: string,
  connectionIds: string[]
): Promise<{ moved: number; skipped: number }> {
  if (connectionIds.length === 0) return { moved: 0, skipped: 0 };
  const db = getDbInstance() as unknown as DbLike;
  const now = new Date().toISOString();
  let moved = 0;
  let skipped = 0;
  for (const id of connectionIds) {
    const conn = await getProviderConnectionById(id);
    if (!conn) {
      skipped++;
      continue;
    }
    const connRecord = conn as unknown as Record<string, unknown>;
    const authType = typeof connRecord.authType === "string" ? connRecord.authType : null;
    if (authType !== "apikey") {
      // No recoverable plaintext apikey for oauth/cookie — can't pool it.
      skipped++;
      continue;
    }
    const apiKey = typeof connRecord.apiKey === "string" ? connRecord.apiKey : null;
    if (!apiKey) {
      skipped++;
      continue;
    }
    const psd =
      connRecord.providerSpecificData &&
      typeof connRecord.providerSpecificData === "object" &&
      !Array.isArray(connRecord.providerSpecificData)
        ? (connRecord.providerSpecificData as Record<string, unknown>)
        : null;
    const dataJson = psd && Object.keys(psd).length > 0 ? JSON.stringify(psd) : null;
    try {
      db.prepare(
        `INSERT INTO key_pool (id, provider, name, key, data, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(uuidv4(), provider, connRecord.name || null, apiKey, dataJson, now);
    } catch {
      // UNIQUE(provider, key) — key already in pool. Still remove the connection
      // so the operator's intent (get this key out of the active set) is honored.
    }
    const deleted = await deleteProviderConnection(id);
    if (deleted) moved++;
    else skipped++;
  }
  backupDbFile("pre-write");
  return { moved, skipped };
}
