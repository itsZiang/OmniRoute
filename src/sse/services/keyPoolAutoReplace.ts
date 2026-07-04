/**
 * keyPoolAutoReplace.ts — Auto-replace a quota/credits-exhausted upstream API
 * key connection with a fresh key from that provider's key pool.
 *
 * Triggered from `markAccountUnavailable` (src/sse/services/auth.ts) after the
 * cooldown/terminal-state write has finished, only when the failing connection
 * is an `apikey`-type connection AND the upstream error indicates the key's
 * quota/credits are exhausted (not a transient 429 or a permission/model error).
 * Runs fire-and-forget so it never blocks the response stream. Re-entrant guard
 * prevents two concurrent replaces on the same failing connection.
 *
 * Ported from 9router's `auth.js::autoReplaceFromPool`.
 */

import { getProviderConnections, updateProviderConnection } from "@/models";
import { getPoolKeys, pullKeysFromPool, createPoolConnections } from "@/lib/db/keyPool";
import { isKeyPoolAutoReplaceEnabled } from "@/shared/utils/featureFlags";
import * as log from "../utils/logger";

const replacingConnections = new Set<string>();

type JsonRecord = Record<string, unknown>;

/**
 * Pop one fresh key from `provider`'s pool and promote it into a new
 * provider_connections row (auth_type="apikey", inheriting
 * providerSpecificData.baseUrl from an existing active connection so
 * OpenAI/Anthropic-compatible nodes keep routing correctly). Then disables the
 * failing connection. No-op if:
 *  - auto-replace flag is off
 *  - pool is empty
 *  - replacement key already exists as an active connection (only disables the failing key)
 *  - a replace for `failingConnectionId` is already in flight
 */
export async function autoReplaceFromPool(
  provider: string,
  failingConnectionId: string
): Promise<void> {
  if (replacingConnections.has(failingConnectionId)) return;
  replacingConnections.add(failingConnectionId);
  try {
    if (!isKeyPoolAutoReplaceEnabled()) return;

    const existing = (await getProviderConnections({ provider, isActive: true })) as JsonRecord[];
    const existingKeys = existing
      .map((c) => (typeof c.apiKey === "string" ? c.apiKey : null))
      .filter((k): k is string => Boolean(k));

    const pulled = await pullKeysFromPool(provider, 1, existingKeys);
    if (pulled.length === 0) {
      log.warn(
        "AUTH",
        `[POOL] pool empty for ${provider}, cannot auto-replace — disabling failing key only`
      );
      await updateProviderConnection(failingConnectionId, { isActive: false }).catch(() => {});
      return;
    }

    // Inherit baseUrl (etc.) from an existing active compatible-node connection
    // so the promoted key routes to the same upstream endpoint as the others.
    const inheritPsd =
      (existing.find((c) => {
        const psd = c.providerSpecificData as JsonRecord | undefined;
        return psd && typeof psd.baseUrl === "string" && psd.baseUrl.length > 0;
      })?.providerSpecificData as JsonRecord | undefined) || null;

    const created = await createPoolConnections(provider, pulled, existingKeys, inheritPsd);
    if (created === 0) {
      log.warn(
        "AUTH",
        `[POOL] replacement key already in connections for ${provider} — disabling failing key only`
      );
    } else {
      log.info("AUTH", `[POOL] auto-replaced key for ${provider} (created=${created})`);
    }

    await updateProviderConnection(failingConnectionId, { isActive: false }).catch(() => {});
  } catch (err) {
    log.warn(
      "AUTH",
      `[POOL] auto-replace failed for ${provider}: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    replacingConnections.delete(failingConnectionId);
  }
}

// Re-export for tests that want to clear the in-process guard between cases.
export function __clearReentrantGuardForTests(): void {
  replacingConnections.clear();
}
