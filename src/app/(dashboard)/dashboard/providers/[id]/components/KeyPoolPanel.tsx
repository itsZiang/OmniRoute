"use client";

/**
 * KeyPoolPanel — per-provider reserve API key pool.
 *
 * Lets an operator paste bulk `name|key` lines into the pool, pull pool keys
 * into live provider_connections, move apikey connections back into the pool,
 * and remove individual pool keys. Keys show masked unless the server reports
 * `reveal=true` (the `ALLOW_API_KEY_REVEAL` flag).
 *
 * Auto-replace (when a quota-exhausted active key is auto-replaced from the
 * pool) is gated behind the separate `ALLOW_KEYPOOL_AUTOREPLACE` flag — the
 * panel reads the current pool state, mutations happen in `markAccountUnavailable`.
 */

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card, Button } from "@/shared/components";
import { useKeyPool } from "../hooks/useKeyPool";
import AddToPoolModal from "./AddToPoolModal";

interface KeyPoolPanelProps {
  providerId: string;
  /** Selected connection ids (from parent connections table) — used by "To pool". */
  selectedConnectionIds?: Set<string>;
  /** Callback to refresh connections after pull/push (so the parent table re-renders). */
  onConnectionsMutated?: () => void;
}

export default function KeyPoolPanel({
  providerId,
  selectedConnectionIds,
  onConnectionsMutated,
}: KeyPoolPanelProps) {
  const t = useTranslations();
  const pool = useKeyPool(providerId);
  const [pullCount, setPullCount] = useState(30);
  const [showAddModal, setShowAddModal] = useState(false);

  const selectedIds = useMemo(
    () => (selectedConnectionIds ? Array.from(selectedConnectionIds) : []),
    [selectedConnectionIds]
  );

  const handlePull = async () => {
    const res = await pool.pull(pullCount);
    if (res && (res.created > 0 || res.pulled > 0)) onConnectionsMutated?.();
  };

  const handlePushSelected = async () => {
    if (selectedIds.length === 0) return;
    const res = await pool.push(selectedIds);
    if (res && res.moved > 0) onConnectionsMutated?.();
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">🔑 {t("keyPoolTitle") || "Key Pool"}</h2>
        <span className="text-sm text-gray-500">
          {pool.count} {t("keyPoolKeys") || "key(s) in pool"}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <Button color="outline" onClick={() => setShowAddModal(true)} disabled={!!pool.busy}>
          {t("keyPoolAddToPool") || "Add to pool"}
        </Button>
        <div className="flex items-center gap-1">
          <Button color="outline" onClick={handlePull} disabled={!!pool.busy || pool.count === 0}>
            {t("keyPoolPull") || "Pull from pool"}
          </Button>
          <input
            type="number"
            min={1}
            max={100}
            value={pullCount}
            onChange={(e) => setPullCount(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
            className="w-16 px-2 py-1 border rounded text-sm"
            aria-label={t("keyPoolPullCount") || "Pull count"}
            disabled={!!pool.busy}
          />
        </div>
        <Button
          color="outline"
          onClick={handlePushSelected}
          disabled={!!pool.busy || selectedIds.length === 0}
          title={
            selectedIds.length === 0
              ? t("keyPoolPushNeedSelection") || "Select one or more connections above"
              : ""
          }
        >
          {t("keyPoolPushSelected") || "Send selected to pool"}
          {selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
        </Button>
        <Button
          color="ghost"
          onClick={() => pool.fetchKeys()}
          disabled={!!pool.busy}
          title={t("keyPoolRefresh") || "Refresh"}
        >
          ↻
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-3 py-2">#</th>
              <th className="text-left px-3 py-2">{t("keyPoolColName") || "Name"}</th>
              <th className="text-left px-3 py-2">{t("keyPoolColKey") || "Key"}</th>
              <th className="text-left px-3 py-2">{t("keyPoolColCreatedAt") || "Added"}</th>
              <th className="text-right px-3 py-2">{t("keyPoolColActions") || "Actions"}</th>
            </tr>
          </thead>
          <tbody>
            {pool.loading && pool.keys.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  …
                </td>
              </tr>
            ) : pool.keys.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  {t("keyPoolEmpty") || 'Pool is empty. Paste reserve keys via "Add to pool".'}
                </td>
              </tr>
            ) : (
              pool.keys.map((k, i) => (
                <tr key={k.id} className="border-t">
                  <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-3 py-2">
                    {k.name || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs break-all">{k.key}</td>
                  <td className="px-3 py-2 text-gray-500">
                    {k.createdAt ? new Date(k.createdAt).toLocaleString() : ""}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      color="ghost"
                      onClick={() => pool.removeKey(k.id)}
                      disabled={!!pool.busy}
                    >
                      ✕
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!pool.reveal && pool.count > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          {t("keyPoolMaskedHint") ||
            'Keys are masked. Enable "API Key Reveal" in Dashboard > Settings > Feature Flags to see full values.'}
        </p>
      )}

      <AddToPoolModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={async (lines) => {
          const res = await pool.addKeys(lines);
          if (res) setShowAddModal(false);
        }}
        disabled={!!pool.busy}
      />
    </Card>
  );
}
