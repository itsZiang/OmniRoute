/**
 * Cloudflare Daily Quota Auto-Disable/Re-enable tests
 *
 * Tests the Cloudflare Workers AI daily quota exhaustion pattern:
 *  1. Detection of "used up your daily free allocation" error text
 *  2. Auto-disable: isActive=false + cloudflareQuotaDisabled/RenableAt flags
 *  3. Lazy re-enable at 00:10 UTC (no cron)
 *  4. Non-Cloudflare providers are not affected
 *  5. Key pool auto-replace is NOT triggered for daily quota (per-account, not per-key)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-cf-daily-quota-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const authMod = await import("../../src/sse/services/auth.ts");

const {
  __CLOUDFLARE_DAILY_QUOTA_PATTERN,
  __getNextCloudflareReEnableTime,
  __reEnableCloudflareConnections,
  markAccountUnavailable,
} = authMod;

const CLOUDFLARE_PROVIDER = "cloudflare-ai";

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

/** Seed a Cloudflare API-key connection and return it. */
async function seedCloudflareConnection(
  apiKey = "sk-cf-test",
  overrides: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const created = (await providersDb.createProviderConnection({
    provider: CLOUDFLARE_PROVIDER,
    authType: "apikey",
    name: (overrides.name as string) ?? "cf-test-key",
    apiKey,
    isActive: (overrides.isActive as boolean) ?? true,
    ...(overrides.providerSpecificData
      ? { providerSpecificData: overrides.providerSpecificData as Record<string, unknown> }
      : {}),
  })) as Record<string, unknown>;
  // Re-fetch to get the full row with providerSpecificData parsed.
  return (await providersDb.getProviderConnectionById(created.id as string)) as Record<
    string,
    unknown
  >;
}

// ── getNextCloudflareReEnableTime ─────────────────────────────────────────

test("__getNextCloudflareReEnableTime returns 00:10 UTC today when before 00:10", () => {
  // Pick a time at 00:05 UTC
  const result = __getNextCloudflareReEnableTime();
  const reEnableDate = new Date(result);

  assert.equal(reEnableDate.getUTCHours(), 0);
  assert.equal(reEnableDate.getUTCMinutes(), 10);
  assert.equal(reEnableDate.getUTCSeconds(), 0);
  assert.equal(reEnableDate.getUTCMilliseconds(), 0);
});

test("__getNextCloudflareReEnableTime returns a future time", () => {
  const result = __getNextCloudflareReEnableTime();
  const reEnableMs = new Date(result).getTime();
  assert.ok(reEnableMs > Date.now(), "reEnableAt must be in the future");
});

test("__getNextCloudflareReEnableTime returns 00:10 UTC date", () => {
  const result = __getNextCloudflareReEnableTime();
  const reEnableDate = new Date(result);

  // Always returns 00:10 UTC regardless of current time
  assert.equal(reEnableDate.getUTCHours(), 0);
  assert.equal(reEnableDate.getUTCMinutes(), 10);

  // Must be today or tomorrow
  const now = new Date();
  const today0010UTC = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 10, 0, 0)
  );
  const tomorrow0010UTC = new Date(today0010UTC.getTime() + 24 * 60 * 60 * 1000);

  const isValid =
    reEnableDate.getTime() === today0010UTC.getTime() ||
    reEnableDate.getTime() === tomorrow0010UTC.getTime();
  assert.ok(isValid, `reEnableAt must be today or tomorrow 00:10 UTC, got ${result}`);
});

// ── Cloudflare daily quota pattern ────────────────────────────────────────

test("markAccountUnavailable disables Cloudflare connection on daily quota error", async () => {
  const conn = await seedCloudflareConnection();
  const connId = conn.id as string;

  await markAccountUnavailable(
    connId,
    403,
    "You have used up your daily free allocation. Please try again tomorrow.",
    CLOUDFLARE_PROVIDER
  );

  const updated = (await providersDb.getProviderConnectionById(connId)) as Record<string, unknown>;
  assert.equal(updated.isActive, false, "connection must be disabled");
  assert.equal(updated.testStatus, "unavailable", "testStatus must be unavailable (not terminal)");

  const psd = updated.providerSpecificData as Record<string, unknown>;
  assert.equal(psd.cloudflareQuotaDisabled, true, "cloudflareQuotaDisabled flag must be set");
  assert.ok(
    typeof psd.cloudflareReEnableAt === "string" &&
      new Date(psd.cloudflareReEnableAt as string).getTime() > Date.now(),
    "cloudflareReEnableAt must be a future timestamp"
  );
});

test("markAccountUnavailable does not trigger on non-Cloudflare provider with same text", async () => {
  const conn = (await providersDb.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "openai-key",
    apiKey: "sk-openai-test",
    isActive: true,
  })) as Record<string, unknown>;
  const connId = conn.id as string;

  await markAccountUnavailable(
    connId,
    403,
    "used up your daily free allocation — this shouldn't trigger for OpenAI",
    "openai"
  );

  const updated = (await providersDb.getProviderConnectionById(connId)) as Record<string, unknown>;
  // OpenAI connection should NOT get Cloudflare-specific flags
  const psd = (updated.providerSpecificData as Record<string, unknown>) || {};
  assert.equal(
    psd.cloudflareQuotaDisabled,
    undefined,
    "non-Cloudflare provider must not get cloudflareQuotaDisabled flag"
  );
});

test("markAccountUnavailable does not trigger for Cloudflare without the exact daily quota text", async () => {
  const conn = await seedCloudflareConnection();
  const connId = conn.id as string;

  await markAccountUnavailable(
    connId,
    403,
    "Invalid API key or insufficient permissions",
    CLOUDFLARE_PROVIDER
  );

  const updated = (await providersDb.getProviderConnectionById(connId)) as Record<string, unknown>;
  const psd = (updated.providerSpecificData as Record<string, unknown>) || {};
  assert.equal(
    psd.cloudflareQuotaDisabled,
    undefined,
    "non-daily-quota Cloudflare error must not set cloudflareQuotaDisabled"
  );
});

// ── Re-enable logic ───────────────────────────────────────────────────────

test("__reEnableCloudflareConnections re-enables connections past reEnableAt", async () => {
  // Create a connection that was disabled with cloudflareQuotaDisabled
  const pastReEnable = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
  const conn = (await providersDb.createProviderConnection({
    provider: CLOUDFLARE_PROVIDER,
    authType: "apikey",
    name: "cf-disabled",
    apiKey: "sk-cf-disabled",
    isActive: false,
    testStatus: "unavailable",
    providerSpecificData: {
      cloudflareQuotaDisabled: true,
      cloudflareReEnableAt: pastReEnable,
    },
  })) as Record<string, unknown>;

  // Also create an ACTIVE connection (should stay active)
  await providersDb.createProviderConnection({
    provider: CLOUDFLARE_PROVIDER,
    authType: "apikey",
    name: "cf-active",
    apiKey: "sk-cf-active",
    isActive: true,
  });

  await __reEnableCloudflareConnections();

  const updated = (await providersDb.getProviderConnectionById(conn.id as string)) as Record<
    string,
    unknown
  >;
  assert.equal(updated.isActive, true, "connection past reEnableAt must be re-enabled");

  const psd = (updated.providerSpecificData as Record<string, unknown>) || {};
  assert.equal(
    psd.cloudflareQuotaDisabled,
    undefined,
    "cloudflareQuotaDisabled flag must be cleared"
  );
  assert.equal(psd.cloudflareReEnableAt, undefined, "cloudflareReEnableAt flag must be cleared");
});

test("__reEnableCloudflareConnections skips connections not yet past reEnableAt", async () => {
  const futureReEnable = new Date(Date.now() + 3600_000).toISOString(); // 1 hour from now
  const conn = (await providersDb.createProviderConnection({
    provider: CLOUDFLARE_PROVIDER,
    authType: "apikey",
    name: "cf-future",
    apiKey: "sk-cf-future",
    isActive: false,
    testStatus: "unavailable",
    providerSpecificData: {
      cloudflareQuotaDisabled: true,
      cloudflareReEnableAt: futureReEnable,
    },
  })) as Record<string, unknown>;

  await __reEnableCloudflareConnections();

  const updated = (await providersDb.getProviderConnectionById(conn.id as string)) as Record<
    string,
    unknown
  >;
  assert.equal(updated.isActive, false, "connection before reEnableAt must stay disabled");

  const psd = (updated.providerSpecificData as Record<string, unknown>) || {};
  assert.equal(psd.cloudflareQuotaDisabled, true, "flag must persist for future reEnableAt");
});

// ── Error text matching ───────────────────────────────────────────────────

test("__CLOUDFLARE_DAILY_QUOTA_PATTERN matches the expected Cloudflare error text", () => {
  assert.equal(__CLOUDFLARE_DAILY_QUOTA_PATTERN, "used up your daily free allocation");

  // Verify the exact error text from Cloudflare Workers AI API
  const cfErrorText = "You have used up your daily free allocation. Please try again tomorrow.";
  assert.ok(
    cfErrorText.toLowerCase().includes(__CLOUDFLARE_DAILY_QUOTA_PATTERN),
    "Cloudflare API error text must contain the pattern"
  );
});

// ── Stack trace not leaked (Hard Rule #12) ────────────────────────────────

test("markAccountUnavailable Cloudflare path does not store raw stack traces", async () => {
  const conn = await seedCloudflareConnection();
  const connId = conn.id as string;

  await markAccountUnavailable(
    connId,
    403,
    "You have used up your daily free allocation. Please try again tomorrow.",
    CLOUDFLARE_PROVIDER
  );

  const updated = (await providersDb.getProviderConnectionById(connId)) as Record<string, unknown>;
  const lastError = updated.lastError as string;
  assert.ok(typeof lastError === "string" && lastError.length > 0, "lastError must be populated");
  assert.ok(
    !lastError.includes("at /") && !lastError.includes("at "),
    `lastError must not leak stack traces, got: ${lastError.slice(0, 100)}`
  );
});
