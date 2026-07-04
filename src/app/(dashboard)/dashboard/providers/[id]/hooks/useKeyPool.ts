"use client";

/**
 * useKeyPool — per-provider reserve API key pool CRUD/mutations for the
 * provider detail page (Dashboard > Providers > [id] > 🔑 Key Pool).
 *
 * Endpoints:
 *   GET    /api/providers/[id]/pool?page=&limit=
 *   POST   /api/providers/[id]/pool            body {lines} | {keys}
 *   DELETE /api/providers/[id]/pool?keyId=
 *   POST   /api/providers/[id]/pool/pull        body {count}
 *   POST   /api/providers/[id]/pool/push        body {connectionIds}
 *
 * Pool keys are stored plaintext (self-hosted). The GET endpoint masks the key
 * unless `ALLOW_API_KEY_REVEAL` is enabled (server-side; surfaced via
 * `reveal` in the response).
 */

import { useState, useCallback, useEffect } from "react";
import { useNotificationStore } from "@/store/notificationStore";

export interface PoolKeyRow {
  id: string;
  name: string | null;
  key: string;
  createdAt: string;
}

interface PoolListResponse {
  keys: PoolKeyRow[];
  count: number;
  page: number;
  limit: number;
  reveal: boolean;
}

export function useKeyPool(providerId: string | null) {
  const notify = useNotificationStore((s) => s.addNotification);
  const [keys, setKeys] = useState<PoolKeyRow[]>([]);
  const [count, setCount] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchKeys = useCallback(
    async (page = 1, limit = 50) => {
      if (!providerId) return;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/providers/${encodeURIComponent(providerId)}/pool?page=${page}&limit=${limit}`
        );
        if (!res.ok) throw new Error(`Failed to fetch pool (${res.status})`);
        const data = (await res.json()) as PoolListResponse;
        setKeys(data.keys || []);
        setCount(data.count || 0);
        setReveal(Boolean(data.reveal));
      } catch (err) {
        notify({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        setLoading(false);
      }
    },
    [providerId, notify]
  );

  const addKeys = useCallback(
    async (lines: string): Promise<{ added: number; skipped: number } | null> => {
      if (!providerId) return null;
      setBusy("add");
      try {
        const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/pool`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to add keys (${res.status})`);
        }
        const data = await res.json();
        await fetchKeys();
        notify({
          type: "success",
          message: `Added ${data.added} key(s)${data.skipped ? `, skipped ${data.skipped} duplicate(s)` : ""}`,
        });
        return { added: data.added, skipped: data.skipped };
      } catch (err) {
        notify({ type: "error", message: err instanceof Error ? err.message : String(err) });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [providerId, fetchKeys, notify]
  );

  const removeKey = useCallback(
    async (keyId: string) => {
      if (!providerId || !keyId) return;
      setBusy(`del:${keyId}`);
      try {
        const res = await fetch(
          `/api/providers/${encodeURIComponent(providerId)}/pool?keyId=${encodeURIComponent(keyId)}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to delete key (${res.status})`);
        }
        await fetchKeys();
        notify({ type: "success", message: "Key removed from pool" });
      } catch (err) {
        notify({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(null);
      }
    },
    [providerId, fetchKeys, notify]
  );

  const pull = useCallback(
    async (count: number): Promise<{ created: number; pulled: number } | null> => {
      if (!providerId) return null;
      setBusy("pull");
      try {
        const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/pool/pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ count }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to pull (${res.status})`);
        }
        const data = await res.json();
        await fetchKeys();
        notify({
          type: "success",
          message: data.created
            ? `Pulled ${data.created} key(s) into connections`
            : "Pool empty — no keys to pull",
        });
        return { created: data.created, pulled: data.pulled };
      } catch (err) {
        notify({ type: "error", message: err instanceof Error ? err.message : String(err) });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [providerId, fetchKeys, notify]
  );

  const push = useCallback(
    async (connectionIds: string[]): Promise<{ moved: number; skipped: number } | null> => {
      if (!providerId || connectionIds.length === 0) return null;
      setBusy("push");
      try {
        const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/pool/push`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connectionIds }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to push (${res.status})`);
        }
        const data = await res.json();
        await fetchKeys();
        notify({
          type: "success",
          message: `Moved ${data.moved} connection(s) back to pool${
            data.skipped ? `, skipped ${data.skipped}` : ""
          }`,
        });
        return { moved: data.moved, skipped: data.skipped };
      } catch (err) {
        notify({ type: "error", message: err instanceof Error ? err.message : String(err) });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [providerId, fetchKeys, notify]
  );

  // Initial load.
  useEffect(() => {
    if (providerId) fetchKeys(1);
  }, [providerId, fetchKeys]);

  return { keys, count, reveal, loading, busy, fetchKeys, addKeys, removeKey, pull, push };
}
