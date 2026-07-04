import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-key-pool-repo-"));
process.env.DATA_DIR = TEST_DATA_DIR;
// Field encryption pass-through (no STORAGE_ENCRYPTION_KEY set) keeps keys
// plaintext for assertions — same as the existing api-key-reveal tests.
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const keyPoolDb = await import("../../src/lib/db/keyPool.ts");
const providersDb = await import("../../src/lib/db/providers.ts");

const PROVIDER = "openai";

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("addKeysToPool inserts and dedupes against existing rows", async () => {
  const r1 = await keyPoolDb.addKeysToPool(PROVIDER, [
    { name: "primary", key: "sk-aaa" },
    { key: "sk-bbb" },
  ]);
  assert.equal(r1.added, 2);
  assert.equal(r1.skipped, 0);

  // Re-adding the same key → skipped (UNIQUE(provider, key) enforced).
  const r2 = await keyPoolDb.addKeysToPool(PROVIDER, [{ key: "sk-aaa" }]);
  assert.equal(r2.added, 0);
  assert.equal(r2.skipped, 1);

  // Adding a different key under the same name is allowed.
  const r3 = await keyPoolDb.addKeysToPool(PROVIDER, [{ name: "backup", key: "sk-ccc" }]);
  assert.equal(r3.added, 1);

  const count = await keyPoolDb.getPoolCount(PROVIDER);
  assert.equal(count, 3);
});

test("getPoolKeys returns keys in FIFO order (created_at ASC)", async () => {
  await keyPoolDb.addKeysToPool(PROVIDER, [
    { key: "sk-first" },
    { key: "sk-second" },
    { key: "sk-third" },
  ]);
  const keys = await keyPoolDb.getPoolKeys(PROVIDER);
  assert.deepEqual(
    keys.map((k) => k.key),
    ["sk-first", "sk-second", "sk-third"]
  );
});

test("pullKeysFromPool pops FIFO, deletes the popped rows, skips existing connection keys", async () => {
  await keyPoolDb.addKeysToPool(PROVIDER, [{ key: "sk-a" }, { key: "sk-b" }, { key: "sk-c" }]);
  // Pull 2 keys, but skip sk-a (treat it as already a connection).
  const pulled = await keyPoolDb.pullKeysFromPool(PROVIDER, 2, ["sk-a"]);
  assert.equal(pulled.length, 2);
  assert.equal(pulled[0].key, "sk-b");
  assert.equal(pulled[1].key, "sk-c");

  const remaining = await keyPoolDb.getPoolKeys(PROVIDER);
  assert.deepEqual(
    remaining.map((k) => k.key),
    ["sk-a"]
  );
});

test("pullKeysFromPool with n=0 returns no keys and deletes nothing", async () => {
  await keyPoolDb.addKeysToPool(PROVIDER, [{ key: "sk-a" }]);
  const pulled = await keyPoolDb.pullKeysFromPool(PROVIDER, 0, []);
  assert.equal(pulled.length, 0);
  const count = await keyPoolDb.getPoolCount(PROVIDER);
  assert.equal(count, 1);
});

test("moveConnectionsToPool rejects non-apikey connections and skips them", async () => {
  // Create an oauth-type connection (no apikey to recover).
  const created = await providersDb.createProviderConnection({
    provider: PROVIDER,
    authType: "oauth",
    email: "test@example.com",
    accessToken: "tok-123",
    isActive: true,
  });
  const oauthId = (created as any).id as string;

  const r = await keyPoolDb.moveConnectionsToPool(PROVIDER, [oauthId]);
  assert.equal(r.moved, 0);
  assert.equal(r.skipped, 1);

  // Connection should still exist (not deleted).
  const stillThere = await providersDb.getProviderConnectionById(oauthId);
  assert.ok(stillThere, "oauth connection must not be deleted");
});

test("moveConnectionsToPool moves an apikey connection's key back into the pool", async () => {
  const created = await providersDb.createProviderConnection({
    provider: PROVIDER,
    authType: "apikey",
    name: "account1",
    apiKey: "sk-real-key",
    isActive: true,
  });
  const connId = (created as any).id as string;

  const r = await keyPoolDb.moveConnectionsToPool(PROVIDER, [connId]);
  assert.equal(r.moved, 1);

  // Connection deleted, key now in pool.
  const gone = await providersDb.getProviderConnectionById(connId);
  assert.equal(gone, null);

  const poolKeys = await keyPoolDb.getPoolKeys(PROVIDER);
  assert.equal(poolKeys.length, 1);
  assert.equal(poolKeys[0].key, "sk-real-key");
  assert.equal(poolKeys[0].name, "account1");
});

test("createPoolConnections inherits providerSpecificData.baseUrl from an existing active connection", async () => {
  // Existing compatible-node connection with a baseUrl.
  await providersDb.createProviderConnection({
    provider: "openai-compatible-foo",
    authType: "apikey",
    name: "node-default",
    apiKey: "sk-existing",
    isActive: true,
    providerSpecificData: { baseUrl: "https://api.foo.com/v1" },
  });

  const pulled = [
    {
      id: "pool-1",
      provider: "openai-compatible-foo",
      name: "reserve-1",
      key: "sk-reserve",
      providerSpecificData: null,
      createdAt: new Date().toISOString(),
    },
  ];
  const created = await keyPoolDb.createPoolConnections("openai-compatible-foo", pulled, [], {
    baseUrl: "https://api.foo.com/v1",
  });
  assert.equal(created, 1);

  const all = (await providersDb.getProviderConnections({
    provider: "openai-compatible-foo",
  })) as any[];
  const newConn = all.find((c) => c.name === "reserve-1");
  assert.ok(newConn, "promoted connection must exist");
  assert.equal(newConn.apiKey, "sk-reserve");
  assert.equal(newConn.providerSpecificData?.baseUrl, "https://api.foo.com/v1");
});

test("createPoolConnections skips keys that already exist as connections (dedup)", async () => {
  await providersDb.createProviderConnection({
    provider: PROVIDER,
    authType: "apikey",
    name: "dup",
    apiKey: "sk-already-active",
    isActive: true,
  });
  const pulled = [
    {
      id: "pool-1",
      provider: PROVIDER,
      name: null,
      key: "sk-already-active",
      providerSpecificData: null,
      createdAt: new Date().toISOString(),
    },
  ];
  const created = await keyPoolDb.createPoolConnections(
    PROVIDER,
    pulled,
    ["sk-already-active"],
    null
  );
  assert.equal(created, 0, "duplicate key must not create a second connection");
});

test("removeKeyFromPool deletes by id and returns false for unknown ids", async () => {
  const r = await keyPoolDb.addKeysToPool(PROVIDER, [{ key: "sk-deleteme" }]);
  const keys = await keyPoolDb.getPoolKeys(PROVIDER);
  const id = keys[0].id;

  assert.equal(await keyPoolDb.removeKeyFromPool(id), true);
  assert.equal(await keyPoolDb.removeKeyFromPool("does-not-exist"), false);
  assert.equal(await keyPoolDb.getPoolCount(PROVIDER), 0);
});
