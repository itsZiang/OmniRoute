import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-key-pool-auto-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const keyPoolDb = await import("../../src/lib/db/keyPool.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const { autoReplaceFromPool, __clearReentrantGuardForTests } =
  await import("../../src/sse/services/keyPoolAutoReplace.ts");

const PROVIDER = "anthropic";

async function resetStorage() {
  delete process.env.ALLOW_KEYPOOL_AUTOREPLACE;
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(async () => {
  await resetStorage();
  __clearReentrantGuardForTests();
});

test.after(async () => {
  delete process.env.ALLOW_KEYPOOL_AUTOREPLACE;
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

async function makeFailingConnection(provider = PROVIDER, apiKey = "sk-failing"): Promise<string> {
  const created = await providersDb.createProviderConnection({
    provider,
    authType: "apikey",
    name: "failing",
    apiKey,
    isActive: true,
  });
  return (created as any).id as string;
}

test("autoReplaceFromPool pops a key and creates a new active connection, disables the failing one", async () => {
  process.env.ALLOW_KEYPOOL_AUTOREPLACE = "true";
  const failingId = await makeFailingConnection();
  await keyPoolDb.addKeysToPool(PROVIDER, [{ name: "reserve", key: "sk-reserve" }]);

  await autoReplaceFromPool(PROVIDER, failingId);

  // Failing connection must be disabled.
  const failing = (await providersDb.getProviderConnectionById(failingId)) as any;
  assert.equal(failing.isActive, false);

  // A new active connection with the reserve key must exist.
  const all = (await providersDb.getProviderConnections({ provider: PROVIDER })) as any[];
  const promoted = all.find((c) => c.apiKey === "sk-reserve");
  assert.ok(promoted, "promoted reserve connection must exist");
  assert.equal(promoted.isActive, true);

  // Pool must be empty (key popped).
  const remaining = await keyPoolDb.getPoolCount(PROVIDER);
  assert.equal(remaining, 0);
});

test("autoReplaceFromPool disables the failing connection even when pool is empty", async () => {
  process.env.ALLOW_KEYPOOL_AUTOREPLACE = "true";
  const failingId = await makeFailingConnection();
  // No keys in the pool.
  await autoReplaceFromPool(PROVIDER, failingId);

  const failing = (await providersDb.getProviderConnectionById(failingId)) as any;
  assert.equal(failing.isActive, false);
  const all = (await providersDb.getProviderConnections({ provider: PROVIDER })) as any[];
  assert.equal(all.length, 1, "no new connection should have been created");
});

test("autoReplaceFromPool is gated by ALLOW_KEYPOOL_AUTOREPLACE=false", async () => {
  process.env.ALLOW_KEYPOOL_AUTOREPLACE = "false";
  const failingId = await makeFailingConnection();
  await keyPoolDb.addKeysToPool(PROVIDER, [{ key: "sk-reserve" }]);

  await autoReplaceFromPool(PROVIDER, failingId);

  // Failing connection must stay ACTIVE (no replace ran).
  const failing = (await providersDb.getProviderConnectionById(failingId)) as any;
  assert.equal(failing.isActive, true);
  // Pool untouched.
  const remaining = await keyPoolDb.getPoolCount(PROVIDER);
  assert.equal(remaining, 1);
});

test("autoReplaceFromPool re-entrant guard prevents two concurrent replaces from double-popping", async () => {
  process.env.ALLOW_KEYPOOL_AUTOREPLACE = "true";
  const failingId = await makeFailingConnection();
  await keyPoolDb.addKeysToPool(PROVIDER, [{ key: "sk-a" }, { key: "sk-b" }]);

  // Fire two concurrent replaces — only one should win the guard.
  await Promise.all([
    autoReplaceFromPool(PROVIDER, failingId),
    autoReplaceFromPool(PROVIDER, failingId),
  ]);

  const all = (await providersDb.getProviderConnections({ provider: PROVIDER })) as any[];
  // Original (disabled) + only ONE promoted reserve (the guard blocked the 2nd).
  const promoted = all.filter((c) => ["sk-a", "sk-b"].includes(c.apiKey));
  assert.equal(
    promoted.length,
    1,
    "only one reserve key must be promoted despite concurrent calls"
  );
});

test("autoReplaceFromPool does not trip a duplicate (replacement key already in connections)", async () => {
  process.env.ALLOW_KEYPOOL_AUTOREPLACE = "true";
  const failingId = await makeFailingConnection(PROVIDER, "sk-failing");
  // The pool contains a key that is already an active connection.
  await providersDb.createProviderConnection({
    provider: PROVIDER,
    authType: "apikey",
    name: "already-active",
    apiKey: "sk-dup",
    isActive: true,
  });
  await keyPoolDb.addKeysToPool(PROVIDER, [{ key: "sk-dup" }]);

  await autoReplaceFromPool(PROVIDER, failingId);

  // Failing key still must be disabled (operator intent: stop using the failed key).
  const failing = (await providersDb.getProviderConnectionById(failingId)) as any;
  assert.equal(failing.isActive, false);
  // No second connection with sk-dup.
  const dups = (await providersDb.getProviderConnections({ provider: PROVIDER })) as any[];
  assert.equal(dups.filter((c) => c.apiKey === "sk-dup").length, 1);
});
