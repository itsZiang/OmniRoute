"use client";

/**
 * useProviderSettings — Phase 1f extraction for Issue #3501.
 *
 * Owns provider-specific global settings state that were previously inline in
 * ProviderDetailPageClient:
 *  - Codex: global service mode, supported models, load/save/error state
 *  - Claude: preferClaudeCodeForUnprefixedClaudeModels toggle, load/save/error state
 *
 * Cycle-safe: imports only from leaf modules (no client imports).
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useNotificationStore } from "@/store/notificationStore";
import {
  CODEX_FAST_TIER_DEFAULT_SUPPORTED_MODELS,
  getCodexGlobalServiceMode,
  resolveCodexGlobalFastServiceTier,
  type CodexGlobalServiceMode,
} from "@/lib/providers/codexFastTier";
import {
  CODEX_GLOBAL_SERVICE_MODE_VALUES,
  getCodexServiceTierLabel,
  providerText,
} from "../providerPageHelpers";
import { NOAUTH_PROVIDERS, WEB_COOKIE_PROVIDERS } from "@/shared/constants/providers";

// ──── types ─────────────────────────────────────────────────────────────────

export interface UseProviderSettingsReturn {
  // Codex
  codexGlobalServiceMode: CodexGlobalServiceMode;
  codexGlobalSupportedModels: string[];
  codexSettingsLoaded: boolean;
  codexSettingsLoadError: string | null;
  savingCodexGlobalServiceMode: boolean;
  codexGlobalServiceModeOptions: Array<{ value: string; label: string }>;
  loadCodexSettings: () => Promise<void>;
  handleChangeCodexGlobalServiceMode: (mode: CodexGlobalServiceMode) => Promise<void>;

  // Claude routing
  preferClaudeCodeForUnprefixedClaudeModels: boolean;
  claudeRoutingSettingsLoaded: boolean;
  claudeRoutingSettingsLoadError: string | null;
  savingClaudeRoutingPreference: boolean;
  loadClaudeRoutingSettings: () => Promise<void>;
  handleToggleClaudeRoutingPreference: (enabled: boolean) => Promise<void>;

  // Round-robin (per-provider)
  rrEnabled: boolean;
  rrStickyCount: number;
  rrSettingsLoaded: boolean;
  savingRR: boolean;
  handleToggleRoundRobin: (enabled: boolean) => Promise<void>;
  handleChangeStickyCount: (count: number) => Promise<void>;
}

export function useProviderSettings(providerId: string): UseProviderSettingsReturn {
  const t = useTranslations("providers");
  const notify = useNotificationStore();

  // ── Codex state ──────────────────────────────────────────────────────────
  const codexSettingsRequestSeqRef = useRef(0);

  const [codexGlobalServiceMode, setCodexGlobalServiceMode] =
    useState<CodexGlobalServiceMode>("none");
  const [codexGlobalSupportedModels, setCodexGlobalSupportedModels] = useState<string[]>([
    ...CODEX_FAST_TIER_DEFAULT_SUPPORTED_MODELS,
  ]);
  const [codexSettingsLoaded, setCodexSettingsLoaded] = useState(false);
  const [codexSettingsLoadError, setCodexSettingsLoadError] = useState<string | null>(null);
  const [savingCodexGlobalServiceMode, setSavingCodexGlobalServiceMode] = useState(false);

  // ── Claude routing state ─────────────────────────────────────────────────
  const [preferClaudeCodeForUnprefixedClaudeModels, setPreferClaudeCodeForUnprefixedClaudeModels] =
    useState(false);
  const [claudeRoutingSettingsLoaded, setClaudeRoutingSettingsLoaded] = useState(false);
  const [claudeRoutingSettingsLoadError, setClaudeRoutingSettingsLoadError] = useState<
    string | null
  >(null);
  const [savingClaudeRoutingPreference, setSavingClaudeRoutingPreference] = useState(false);

  // ── Round-robin state ────────────────────────────────────────────────────
  const [rrEnabled, setRrEnabled] = useState(false);
  const [rrStickyCount, setRrStickyCount] = useState(3);
  const [rrSettingsLoaded, setRrSettingsLoaded] = useState(false);
  const [savingRR, setSavingRR] = useState(false);

  // ── derived ──────────────────────────────────────────────────────────────
  const codexGlobalServiceModeOptions = useMemo(
    () =>
      CODEX_GLOBAL_SERVICE_MODE_VALUES.map((value) => ({
        value,
        label: getCodexServiceTierLabel(t, value),
      })),
    [t]
  );

  // ── Codex settings loader ────────────────────────────────────────────────
  const loadCodexSettings = useCallback(async () => {
    const requestSeq = codexSettingsRequestSeqRef.current + 1;
    codexSettingsRequestSeqRef.current = requestSeq;
    const isCurrentRequest = () => codexSettingsRequestSeqRef.current === requestSeq;

    if (providerId !== "codex") {
      setCodexSettingsLoaded(false);
      setCodexSettingsLoadError(null);
      return;
    }

    setCodexSettingsLoaded(false);
    setCodexSettingsLoadError(null);

    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Settings request failed with HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!data || typeof data !== "object") {
        throw new Error("Settings response was empty");
      }
      if (!isCurrentRequest()) return;
      const resolvedCodexServiceTier = resolveCodexGlobalFastServiceTier(data);
      setCodexGlobalServiceMode(getCodexGlobalServiceMode(data));
      setCodexGlobalSupportedModels([...resolvedCodexServiceTier.supportedModels]);
      setCodexSettingsLoaded(true);
    } catch (error) {
      if (!isCurrentRequest()) return;
      setCodexSettingsLoaded(false);
      setCodexSettingsLoadError(error instanceof Error ? error.message : "Failed to load settings");
    }
  }, [providerId]);

  useEffect(() => {
    void loadCodexSettings();
  }, [loadCodexSettings]);

  // ── Claude routing settings loader ───────────────────────────────────────
  const loadClaudeRoutingSettings = useCallback(async () => {
    if (providerId !== "claude") {
      setClaudeRoutingSettingsLoaded(false);
      setClaudeRoutingSettingsLoadError(null);
      return;
    }

    setClaudeRoutingSettingsLoaded(false);
    setClaudeRoutingSettingsLoadError(null);

    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Settings request failed with HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!data || typeof data !== "object") {
        throw new Error("Settings response was empty");
      }
      setPreferClaudeCodeForUnprefixedClaudeModels(
        data.preferClaudeCodeForUnprefixedClaudeModels === true
      );
      setClaudeRoutingSettingsLoaded(true);
    } catch (error) {
      setClaudeRoutingSettingsLoaded(false);
      setClaudeRoutingSettingsLoadError(
        error instanceof Error ? error.message : "Failed to load settings"
      );
    }
  }, [providerId]);

  useEffect(() => {
    void loadClaudeRoutingSettings();
  }, [loadClaudeRoutingSettings]);

  // ── Codex service mode handler ───────────────────────────────────────────
  const handleChangeCodexGlobalServiceMode = async (mode: CodexGlobalServiceMode) => {
    if (savingCodexGlobalServiceMode || !codexSettingsLoaded) return;
    setSavingCodexGlobalServiceMode(true);
    const previousMode = codexGlobalServiceMode;
    setCodexGlobalServiceMode(mode);
    try {
      const tier = mode === "none" ? (previousMode !== "none" ? previousMode : undefined) : mode;
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codexServiceTier: {
            enabled: mode !== "none",
            ...(tier ? { tier } : {}),
            supportedModels: codexGlobalSupportedModels,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCodexGlobalServiceMode(previousMode);
        notify.error(data.error || "Failed to update Codex service mode");
        return;
      }

      notify.success("Codex service mode updated");
    } catch (error) {
      setCodexGlobalServiceMode(previousMode);
      console.error("Error updating Codex service mode:", error);
      notify.error("Failed to update Codex service mode");
    } finally {
      setSavingCodexGlobalServiceMode(false);
    }
  };

  // ── Claude routing preference handler ───────────────────────────────────
  const handleToggleClaudeRoutingPreference = async (enabled: boolean) => {
    if (savingClaudeRoutingPreference || !claudeRoutingSettingsLoaded) return;
    setSavingClaudeRoutingPreference(true);
    const previous = preferClaudeCodeForUnprefixedClaudeModels;
    setPreferClaudeCodeForUnprefixedClaudeModels(enabled);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferClaudeCodeForUnprefixedClaudeModels: enabled }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPreferClaudeCodeForUnprefixedClaudeModels(previous);
        notify.error(data.error || "Failed to update Claude Code routing preference");
        return;
      }

      const data = await res.json().catch(() => null);
      if (data && typeof data === "object") {
        setPreferClaudeCodeForUnprefixedClaudeModels(
          data.preferClaudeCodeForUnprefixedClaudeModels === true
        );
      }
      notify.success(
        enabled
          ? "Unprefixed Claude models now prefer Claude Code"
          : "Unprefixed Claude models no longer prefer Claude Code"
      );
    } catch (error) {
      setPreferClaudeCodeForUnprefixedClaudeModels(previous);
      console.error("Error updating Claude Code routing preference:", error);
      notify.error(
        providerText(
          t,
          "failedUpdateClaudeRoutingPreference",
          "Failed to update Claude Code routing preference"
        )
      );
    } finally {
      setSavingClaudeRoutingPreference(false);
    }
  };

  // ── Round-robin settings loader ──────────────────────────────────────────
  const loadRoundRobinSettings = useCallback(async () => {
    const noAuthOrWebCookie =
      providerId in (NOAUTH_PROVIDERS as Record<string, unknown>) ||
      providerId in (WEB_COOKIE_PROVIDERS as Record<string, unknown>);
    if (noAuthOrWebCookie) {
      setRrSettingsLoaded(false);
      return;
    }

    setRrSettingsLoaded(false);

    try {
      const response = await fetch(`/api/providers/${providerId}/round-robin`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Round-robin settings request failed with HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!data || typeof data !== "object") {
        throw new Error("Round-robin settings response was empty");
      }
      setRrEnabled(data.enabled === true);
      setRrStickyCount(typeof data.stickyCount === "number" ? data.stickyCount : 3);
      setRrSettingsLoaded(true);
    } catch (error) {
      setRrSettingsLoaded(false);
    }
  }, [providerId]);

  useEffect(() => {
    void loadRoundRobinSettings();
  }, [loadRoundRobinSettings]);

  // ── Round-robin toggle handler ───────────────────────────────────────────
  const handleToggleRoundRobin = useCallback(
    async (enabled: boolean) => {
      if (savingRR || !rrSettingsLoaded) return;
      setSavingRR(true);
      const previousEnabled = rrEnabled;
      setRrEnabled(enabled);

      try {
        const res = await fetch(`/api/providers/${providerId}/round-robin`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled, stickyCount: rrStickyCount }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setRrEnabled(previousEnabled);
          notify.error(data.error || "Failed to update round-robin setting");
          return;
        }

        const data = await res.json().catch(() => null);
        if (data && typeof data === "object") {
          setRrEnabled(data.enabled === true);
          setRrStickyCount(typeof data.stickyCount === "number" ? data.stickyCount : rrStickyCount);
        }
        notify.success(
          enabled
            ? providerText(t, "roundRobinEnabled", "Round-robin enabled")
            : providerText(t, "roundRobinDisabled", "Round-robin disabled")
        );
      } catch (error) {
        setRrEnabled(previousEnabled);
        console.error("Error updating round-robin setting:", error);
        notify.error(
          providerText(t, "failedUpdateRoundRobin", "Failed to update round-robin setting")
        );
      } finally {
        setSavingRR(false);
      }
    },
    [savingRR, rrSettingsLoaded, rrEnabled, rrStickyCount, providerId, notify, t]
  );

  // ── Sticky count change handler ──────────────────────────────────────────
  const handleChangeStickyCount = useCallback(
    async (count: number) => {
      if (savingRR || !rrSettingsLoaded) return;
      if (!Number.isFinite(count) || count < 1 || count > 1000) return;
      if (count === rrStickyCount) return;
      setSavingRR(true);
      const previousCount = rrStickyCount;
      setRrStickyCount(count);

      try {
        const res = await fetch(`/api/providers/${providerId}/round-robin`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: rrEnabled, stickyCount: count }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setRrStickyCount(previousCount);
          notify.error(data.error || "Failed to update sticky count");
          return;
        }

        const data = await res.json().catch(() => null);
        if (data && typeof data === "object") {
          const serverCount = data.stickyCount;
          if (typeof serverCount === "number") {
            setRrStickyCount(serverCount);
          }
        }
        notify.success(
          providerText(t, "stickyCountUpdated", "Sticky count set to {count}", { count })
        );
      } catch (error) {
        setRrStickyCount(previousCount);
        console.error("Error updating sticky count:", error);
        notify.error(providerText(t, "failedUpdateStickyCount", "Failed to update sticky count"));
      } finally {
        setSavingRR(false);
      }
    },
    [savingRR, rrSettingsLoaded, rrEnabled, rrStickyCount, providerId, notify, t]
  );

  return {
    // Codex
    codexGlobalServiceMode,
    codexGlobalSupportedModels,
    codexSettingsLoaded,
    codexSettingsLoadError,
    savingCodexGlobalServiceMode,
    codexGlobalServiceModeOptions,
    loadCodexSettings,
    handleChangeCodexGlobalServiceMode,

    // Claude routing
    preferClaudeCodeForUnprefixedClaudeModels,
    claudeRoutingSettingsLoaded,
    claudeRoutingSettingsLoadError,
    savingClaudeRoutingPreference,
    loadClaudeRoutingSettings,
    handleToggleClaudeRoutingPreference,

    // Round-robin
    rrEnabled,
    rrStickyCount,
    rrSettingsLoaded,
    savingRR,
    handleToggleRoundRobin,
    handleChangeStickyCount,
  };
}
