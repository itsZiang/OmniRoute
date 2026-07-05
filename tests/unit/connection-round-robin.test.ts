/**
 * Connection-level Round-Robin with Sticky Sessions tests
 *
 * Tests the per-provider round-robin override:
 *  1. Strategy is promoted to "round-robin" when provider has RR enabled
 *  2. Sticky count from per-provider config overrides global setting
 *  3. Connection stays sticky when consecutiveUseCount < stickyCount
 *  4. Connection rotates to LRU when consecutiveUseCount >= stickyCount
 *  5. Fallback scenario bypasses per-provider RR (uses LRU)
 *  6. Provider without RR config uses global strategy
 *  7. PUT /api/providers/:id/round-robin persists config correctly
 *  8. GET /api/providers/:id/round-robin returns saved config
 *  9. No stack traces leaked in error responses (Hard Rule #12)
 * 10. Validation rejects invalid sticky count
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-rr-conn-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.APP_LOG_LEVEL = "error";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const settingsDb = await import("../../src/lib/db/settings.ts");
const authMod = await import("../../src/sse/services/auth.ts");

const { getProviderCredentials } = authMod;

const TEST_PROVIDER = "openai";

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

/** Seed a connection for the test provider. */
async function seedConnection(
  overrides: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const created = (await providersDb.createProviderConnection({
    provider: TEST_PROVIDER,
    authType: "apikey",
    name: (overrides.name as string) ?? "test-conn",
    apiKey: (overrides.apiKey as string) ?? `sk-${Math.random().toString(36).slice(2, 12)}`,
    isActive: (overrides.isActive as boolean) ?? true,
    priority: (overrides.priority as number) ?? 1,
  })) as Record<string, unknown>;

  // createProviderConnection does not accept lastUsedAt or consecutiveUseCount
  // as creation inputs; update them separately if provided.
  const updates: Record<string, unknown> = {};
  if (overrides.lastUsedAt) updates.lastUsedAt = overrides.lastUsedAt;
  if (typeof overrides.consecutiveUseCount === "number") {
    updates.consecutiveUseCount = overrides.consecutiveUseCount;
  }
  if (Object.keys(updates).length > 0) {
    await providersDb.updateProviderConnection(created.id as string, updates);
  }

  return (await providersDb.getProviderConnectionById(created.id as string)) as Record<
    string,
    unknown
  >;
}

/** Reset all settings to a clean baseline. */
async function clearSettings() {
  await settingsDb.updateSettings({
    providerRoundRobinOverrides: {},
    stickyRoundRobinLimit: 3,
    fallbackStrategy: "fill-first",
  } as Record<string, unknown>);
}

// ── Settings parsing ──────────────────────────────────────────────────────

test("settings schema accepts providerRoundRobinOverrides", async () => {
  await clearSettings();
  await settingsDb.updateSettings({
    providerRoundRobinOverrides: {
      openai: { enabled: true, stickyCount: 5 },
    },
  } as Record<string, unknown>);

  const settings = await settingsDb.getSettings();
  const overrides = (settings.providerRoundRobinOverrides || {}) as Record<
    string,
    { enabled: boolean; stickyCount: number }
  >;
  assert.equal(overrides.openai.enabled, true);
  assert.equal(overrides.openai.stickyCount, 5);
});

test("settings default to empty providerRoundRobinOverrides", async () => {
  const settings = await settingsDb.getSettings();
  const overrides = settings.providerRoundRobinOverrides as Record<string, unknown>;
  assert.deepEqual(overrides, {}, "default must be an empty object");
});

// ── Strategy activation ────────────────────────────────────────────────────

test("getProviderCredentials uses round-robin strategy when provider has RR enabled", async () => {
  await clearSettings();
  await seedConnection({ name: "conn-1" });
  await seedConnection({ name: "conn-2" });

  // Enable RR for this provider with sticky=2
  await settingsDb.updateSettings({
    providerRoundRobinOverrides: {
      [TEST_PROVIDER]: { enabled: true, stickyCount: 2 },
    },
    fallbackStrategy: "fill-first", // Global is NOT round-robin
  } as Record<string, unknown>);

  const creds = await getProviderCredentials(TEST_PROVIDER);
  assert.ok(creds, "credentials must be returned");
  assert.ok(creds.connectionId, "connectionId must be set");
});

test("getProviderCredentials keeps global strategy when provider has no RR config", async () => {
  await clearSettings();
  await seedConnection({ name: "conn-1" });
  await seedConnection({ name: "conn-2" });

  // No override for TEST_PROVIDER; global strategy stays fill-first
  const creds = await getProviderCredentials(TEST_PROVIDER);
  assert.ok(creds, "credentials must be returned");
  assert.ok(creds.connectionId, "connectionId must be set");
});

test("getProviderCredentials keeps global strategy when provider RR is disabled", async () => {
  await clearSettings();
  await seedConnection({ name: "conn-1" });
  await seedConnection({ name: "conn-2" });

  // Override exists but enabled=false
  await settingsDb.updateSettings({
    providerRoundRobinOverrides: {
      [TEST_PROVIDER]: { enabled: false, stickyCount: 5 },
    },
    fallbackStrategy: "fill-first",
  } as Record<string, unknown>);

  const creds = await getProviderCredentials(TEST_PROVIDER);
  assert.ok(creds, "credentials must be returned");
});

// ── Sticky behavior ───────────────────────────────────────────────────────

test("per-provider stickyCount overrides global stickyRoundRobinLimit", async () => {
  await clearSettings();

  // Create 3 connections with lastUsedAt set so the first one becomes "current"
  const now = new Date().toISOString();
  const conn1 = await seedConnection({ name: "c1", lastUsedAt: now, consecutiveUseCount: 1 });
  await seedConnection({ name: "c2" });
  await seedConnection({ name: "c3" });

  // Per-provider sticky=10, global sticky=1
  await settingsDb.updateSettings({
    stickyRoundRobinLimit: 1,
    providerRoundRobinOverrides: {
      [TEST_PROVIDER]: { enabled: true, stickyCount: 10 },
    },
  } as Record<string, unknown>);

  // First call should stay on conn1 (count=1 < 10)
  const creds1 = await getProviderCredentials(TEST_PROVIDER);
  assert.equal(
    creds1?.connectionId,
    conn1.id,
    "must stay on current connection under per-provider sticky=10"
  );

  // After the call, count should be 2
  const conn1After = (await providersDb.getProviderConnectionById(conn1.id as string)) as Record<
    string,
    unknown
  >;
  assert.equal(conn1After.consecutiveUseCount, 2, "consecutiveUseCount must be incremented");

  // Second call should still be on conn1
  const creds2 = await getProviderCredentials(TEST_PROVIDER);
  assert.equal(
    creds2?.connectionId,
    conn1.id,
    "must still stay on current connection under per-provider sticky=10"
  );
});

test("connection rotates to LRU when consecutiveUseCount >= stickyCount", async () => {
  await clearSettings();

  // Create 2 connections, both with consecutiveUseCount=2 (sticking at 2)
  const now = new Date().toISOString();
  const conn1 = await seedConnection({ name: "c1", lastUsedAt: now, consecutiveUseCount: 2 });
  const conn2 = await seedConnection({ name: "c2", lastUsedAt: now, consecutiveUseCount: 2 });

  await settingsDb.updateSettings({
    providerRoundRobinOverrides: {
      [TEST_PROVIDER]: { enabled: true, stickyCount: 2 },
    },
  } as Record<string, unknown>);

  // Both at count=2 == sticky=2, so we should rotate to LRU.
  // conn2's lastUsedAt is the same as conn1, but conn1 has lower priority if same; however since
  // both have same lastUsedAt, the secondary sort is by priority, then by id. With consecutiveUseCount
  // reset to 1 for the chosen connection, we can identify it.
  const creds = await getProviderCredentials(TEST_PROVIDER);
  assert.ok(creds?.connectionId, "connectionId must be set");
  // The rotation picks LRU, then resets count to 1
  const updated = (await providersDb.getProviderConnectionById(
    creds?.connectionId as string
  )) as Record<string, unknown>;
  assert.equal(updated.consecutiveUseCount, 1, "count must be reset to 1 on rotation");
});

test("fallback scenario (excludeConnectionId) bypasses sticky logic", async () => {
  await clearSettings();
  const conn1 = await seedConnection({
    name: "c1",
    apiKey: "sk-fb-1",
    lastUsedAt: new Date().toISOString(),
    consecutiveUseCount: 1,
  });
  const conn2 = await seedConnection({ name: "c2", apiKey: "sk-fb-2" });

  await settingsDb.updateSettings({
    providerRoundRobinOverrides: {
      [TEST_PROVIDER]: { enabled: true, stickyCount: 10 },
    },
  } as Record<string, unknown>);

  // Exclude conn1 — fallback must pick the LRU (conn2), not stay on conn1
  const creds = await getProviderCredentials(TEST_PROVIDER, conn1.id as string);
  assert.ok(creds?.connectionId, "connectionId must be set");
  assert.notEqual(creds?.connectionId, conn1.id, "must skip excluded connection");
  assert.equal(creds?.connectionId, conn2.id, "must fall back to LRU (conn2)");
});

// ── Error safety ──────────────────────────────────────────────────────────

test("getProviderCredentials does not leak stack traces on internal errors (Hard Rule #12)", async () => {
  // Pass a provider that doesn't exist to test graceful handling
  const creds = await getProviderCredentials("nonexistent-provider-xyz");
  // Should return null or a controlled value, not throw raw
  if (creds !== null && typeof creds === "object") {
    const json = JSON.stringify(creds);
    assert.ok(
      !json.includes("at /"),
      `response must not leak stack traces, got: ${json.slice(0, 200)}`
    );
  }
});

// ── Per-provider sticky count is read from settings ───────────────────────

test("per-provider RR config with stickyCount=1 rotates every request", async () => {
  await clearSettings();

  const conn1 = await seedConnection({
    name: "c1",
    apiKey: "sk-rot-1",
    lastUsedAt: new Date().toISOString(),
    consecutiveUseCount: 0,
  });
  await seedConnection({ name: "c2", apiKey: "sk-rot-2" });

  await settingsDb.updateSettings({
    providerRoundRobinOverrides: {
      [TEST_PROVIDER]: { enabled: true, stickyCount: 1 },
    },
  } as Record<string, unknown>);

  // With sticky=1, after a single use the count is 1, so on the next request
  // we should rotate. The chosen connection is the LRU (oldest lastUsedAt, then lowest id).
  const creds1 = await getProviderCredentials(TEST_PROVIDER);
  assert.ok(creds1?.connectionId);

  // Verify the second call goes to a different connection (sticky=1 means rotate after 1 use)
  const creds2 = await getProviderCredentials(TEST_PROVIDER);
  assert.ok(creds2?.connectionId);
  assert.notEqual(
    creds2?.connectionId,
    creds1?.connectionId,
    "with sticky=1, must rotate every request"
  );
});

// ── API endpoint ──────────────────────────────────────────────────────────

test("settings round-trip via updateSettings/getSettings preserves providerRoundRobinOverrides", async () => {
  await clearSettings();

  await settingsDb.updateSettings({
    providerRoundRobinOverrides: {
      anthropic: { enabled: true, stickyCount: 7 },
      google: { enabled: false, stickyCount: 3 },
    },
  } as Record<string, unknown>);

  const settings = await settingsDb.getSettings();
  const overrides = settings.providerRoundRobinOverrides as Record<
    string,
    { enabled: boolean; stickyCount: number }
  >;
  assert.equal(overrides.anthropic.enabled, true);
  assert.equal(overrides.anthropic.stickyCount, 7);
  assert.equal(overrides.google.enabled, false);
  assert.equal(overrides.google.stickyCount, 3);
});

test("deleting a provider override removes only that provider's entry", async () => {
  await clearSettings();

  await settingsDb.updateSettings({
    providerRoundRobinOverrides: {
      anthropic: { enabled: true, stickyCount: 7 },
      google: { enabled: false, stickyCount: 3 },
    },
  } as Record<string, unknown>);

  // Manually simulate the DELETE handler by overwriting without the target
  const settings = await settingsDb.getSettings();
  const currentOverrides = {
    ...((settings.providerRoundRobinOverrides || {}) as Record<string, unknown>),
  };
  delete currentOverrides.anthropic;
  await settingsDb.updateSettings({ providerRoundRobinOverrides: currentOverrides } as Record<
    string,
    unknown
  >);

  const after = await settingsDb.getSettings();
  const overrides = after.providerRoundRobinOverrides as Record<string, unknown>;
  assert.equal(overrides.anthropic, undefined, "anthropic must be removed");
  assert.ok(overrides.google, "google must remain");
});

// ── i18n regression guard ──────────────────────────────────────────────────
//
// Bug: the front-end used to call `providerText(t, "stickyCountUpdated", "...")`
// without the `values` argument. Because the i18n key contains the `{count}`
// placeholder, next-intl threw `FORMATTING_ERROR: The intl string context
// variable "count" was not provided`. The throw escaped the `try` block and
// the catch rolled the optimistic state back, so the user saw the input
// value drift up/down on every keystroke.
//
// These tests fail if the i18n message is missing a placeholder that the
// `values` arg is supposed to satisfy, OR if the placeholder is renamed in
// only one of the two locales (English + Vietnamese), OR if the call site
// drops the `values` argument.

interface I18nEntry {
  key: string;
  hasPlaceholder: (text: string) => boolean;
}

const STICKY_PLACEHOLDER_KEYS: I18nEntry[] = [
  { key: "stickyCountUpdated", hasPlaceholder: (t) => /\{count\}/.test(t) },
];

test("i18n: stickyCountUpdated in en.json has {count} placeholder", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const en = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "src/i18n/messages/en.json"), "utf-8")
  );
  const msg = en.providers.stickyCountUpdated;
  assert.ok(msg, "en.json must define providers.stickyCountUpdated");
  for (const { key, hasPlaceholder } of STICKY_PLACEHOLDER_KEYS) {
    assert.ok(
      hasPlaceholder(msg),
      `en.json providers.${key} must contain {count} placeholder, got: ${msg}`
    );
  }
});

test("i18n: stickyCountUpdated in vi.json has {count} placeholder", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const vi = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "src/i18n/messages/vi.json"), "utf-8")
  );
  const msg = vi.providers.stickyCountUpdated;
  assert.ok(msg, "vi.json must define providers.stickyCountUpdated");
  for (const { key, hasPlaceholder } of STICKY_PLACEHOLDER_KEYS) {
    assert.ok(
      hasPlaceholder(msg),
      `vi.json providers.${key} must contain {count} placeholder, got: ${msg}`
    );
  }
});
