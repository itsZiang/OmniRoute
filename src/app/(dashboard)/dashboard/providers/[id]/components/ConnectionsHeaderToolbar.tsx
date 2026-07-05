"use client";

import { useEffect, useRef, useState } from "react";
import { Button, DistributeProxiesButton, Toggle } from "@/shared/components";
import { providerText, type ProviderMessageTranslator } from "../providerPageHelpers";
import type { CodexGlobalServiceMode } from "@/lib/providers/codexFastTier";

type ConnectionsHeaderToolbarProps = {
  providerId: string;
  providerInfo: any; // resolveDashboardProviderInfo result
  isCompatible: boolean;
  isCommandCode: boolean;
  isOAuth: boolean;
  providerSupportsPat: boolean;
  connections: any[]; // ConnectionRowConnection[]
  batchTesting: boolean;
  batchRetesting: boolean;
  retestingId: string | null;
  proxyConfig: any;
  // from useProviderSettings
  preferClaudeCodeForUnprefixedClaudeModels: boolean;
  claudeRoutingSettingsLoaded: boolean;
  claudeRoutingSettingsLoadError: string | null;
  savingClaudeRoutingPreference: boolean;
  handleToggleClaudeRoutingPreference: () => void;
  loadClaudeRoutingSettings: () => Promise<void>;
  codexGlobalServiceMode: string;
  codexGlobalServiceModeOptions: Array<{ value: string; label: string }>;
  codexSettingsLoaded: boolean;
  codexSettingsLoadError: string | null;
  savingCodexGlobalServiceMode: boolean;
  handleChangeCodexGlobalServiceMode: (mode: any) => void;
  loadCodexSettings: () => Promise<void>;
  // Round-robin (per-provider)
  rrEnabled: boolean;
  rrStickyCount: number;
  rrSettingsLoaded: boolean;
  savingRR: boolean;
  handleToggleRoundRobin: (enabled: boolean) => void;
  handleChangeStickyCount: (count: number) => void;
  // Modal triggers
  onSetProxyTarget: (target: { level: string; id: string; label: string }) => void;
  handleDistributeProxies: () => void;
  handleBatchTestAll: () => void;
  gateConnectionFlow: (callback: () => void) => void;
  openApiKeyAddFlow: () => void;
  openPrimaryAddFlow: () => void;
  openExternalLinkFlow: () => void;
  handleOpenCommandCodeConnect: () => void;
  commandCodeAuthState: { phase: string };
  onOpenOAuthModal: () => void;
  onOpenCodexCliGuide: () => void;
  onOpenImportCodex: () => void;
  onOpenImportClaude: () => void;
  onOpenImportGemini: () => void;
  onOpenImportGrokCli: () => void;
  t: ProviderMessageTranslator;
};

export default function ConnectionsHeaderToolbar({
  providerId,
  providerInfo,
  isCompatible,
  isCommandCode,
  isOAuth,
  providerSupportsPat,
  connections,
  batchTesting,
  batchRetesting,
  retestingId,
  proxyConfig,
  preferClaudeCodeForUnprefixedClaudeModels,
  claudeRoutingSettingsLoaded,
  claudeRoutingSettingsLoadError,
  savingClaudeRoutingPreference,
  handleToggleClaudeRoutingPreference,
  loadClaudeRoutingSettings,
  codexGlobalServiceMode,
  codexGlobalServiceModeOptions,
  codexSettingsLoaded,
  codexSettingsLoadError,
  savingCodexGlobalServiceMode,
  handleChangeCodexGlobalServiceMode,
  loadCodexSettings,
  rrEnabled,
  rrStickyCount,
  rrSettingsLoaded,
  savingRR,
  handleToggleRoundRobin,
  handleChangeStickyCount,
  onSetProxyTarget,
  handleDistributeProxies,
  handleBatchTestAll,
  gateConnectionFlow,
  openApiKeyAddFlow,
  openPrimaryAddFlow,
  openExternalLinkFlow,
  handleOpenCommandCodeConnect,
  commandCodeAuthState,
  onOpenOAuthModal,
  onOpenCodexCliGuide,
  onOpenImportCodex,
  onOpenImportClaude,
  onOpenImportGemini,
  onOpenImportGrokCli,
  t,
}: ConnectionsHeaderToolbarProps) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{t("connections")}</h2>
        {providerId === "claude" && (
          <div
            className="inline-flex items-center gap-2 rounded-lg border border-orange-500/20 bg-orange-500/5 px-2 py-1 text-xs font-medium text-text-muted"
            title={providerText(
              t,
              "preferClaudeCodeForUnprefixedClaudeModelsTooltip",
              "Route bare claude-* model IDs from Claude Code clients through the Claude Code account instead of asking for a provider prefix."
            )}
          >
            <span className="material-symbols-outlined text-[14px] text-orange-500">alt_route</span>
            <span>
              {providerText(
                t,
                "preferClaudeCodeForUnprefixedClaudeModelsLabel",
                "Claude Code default"
              )}
            </span>
            <Toggle
              size="sm"
              checked={preferClaudeCodeForUnprefixedClaudeModels}
              onChange={handleToggleClaudeRoutingPreference}
              disabled={savingClaudeRoutingPreference || !claudeRoutingSettingsLoaded}
              ariaLabel={providerText(
                t,
                "preferClaudeCodeForUnprefixedClaudeModelsAria",
                "Prefer Claude Code for unprefixed Claude models"
              )}
              title={
                preferClaudeCodeForUnprefixedClaudeModels
                  ? providerText(
                      t,
                      "preferClaudeCodeForUnprefixedClaudeModelsDisable",
                      "Disable Claude Code preference for bare claude-* model IDs"
                    )
                  : providerText(
                      t,
                      "preferClaudeCodeForUnprefixedClaudeModelsEnable",
                      "Enable Claude Code preference for bare claude-* model IDs"
                    )
              }
            />
            <span className="text-[11px] text-text-muted/70">
              {preferClaudeCodeForUnprefixedClaudeModels
                ? providerText(t, "toggleOnShort", "On")
                : providerText(t, "toggleOffShort", "Off")}
            </span>
            {claudeRoutingSettingsLoadError ? (
              <button
                type="button"
                onClick={() => void loadClaudeRoutingSettings()}
                className="rounded border border-orange-500/30 px-2 py-0.5 text-[11px] font-medium text-orange-600 hover:bg-orange-500/10 dark:text-orange-300"
                title={claudeRoutingSettingsLoadError}
              >
                {providerText(t, "retry", "Retry")}
              </button>
            ) : null}
          </div>
        )}
        {providerId === "codex" && (
          <div
            className="inline-flex items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-2 py-1 text-xs font-medium text-text-muted"
            title={providerText(
              t,
              "providerDetailServiceModeTooltip",
              "Set a global Codex service mode, or leave accounts on their individual service-tier setting."
            )}
          >
            <span>{providerText(t, "providerDetailServiceModeLabel", "Global service mode:")}</span>
            <select
              value={codexGlobalServiceMode}
              onChange={(event) =>
                handleChangeCodexGlobalServiceMode(event.target.value as CodexGlobalServiceMode)
              }
              disabled={savingCodexGlobalServiceMode || !codexSettingsLoaded}
              aria-label="Global Codex service mode"
              className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-text-main outline-none transition-colors focus:border-primary disabled:opacity-60"
            >
              {codexGlobalServiceModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {codexSettingsLoadError ? (
              <button
                type="button"
                onClick={() => void loadCodexSettings()}
                className="rounded border border-sky-500/30 px-2 py-0.5 text-[11px] font-medium text-sky-600 hover:bg-sky-500/10 dark:text-sky-300"
                title={codexSettingsLoadError}
              >
                {providerText(t, "retry", "Retry")}
              </button>
            ) : null}
          </div>
        )}
        {/* Round-Robin toggle — for ALL providers with connections */}
        <div
          className="inline-flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-2 py-1 text-xs font-medium text-text-muted"
          title={providerText(
            t,
            "roundRobinTooltip",
            "Cycle through API key connections, even when the current key works. Set a sticky count to keep each key serving N consecutive requests before rotating."
          )}
        >
          <span className="material-symbols-outlined text-[14px] text-blue-500">cycle</span>
          <span>{providerText(t, "roundRobinLabel", "Round-Robin")}</span>
          <Toggle
            size="sm"
            checked={rrEnabled}
            onChange={handleToggleRoundRobin}
            disabled={savingRR || !rrSettingsLoaded}
            ariaLabel={providerText(t, "roundRobinAria", "Enable per-provider round-robin")}
            title={
              rrEnabled
                ? providerText(t, "roundRobinDisable", "Disable round-robin for this provider")
                : providerText(t, "roundRobinEnable", "Enable round-robin for this provider")
            }
          />
          <span className="text-[11px] text-text-muted/70">
            {rrEnabled
              ? providerText(t, "toggleOnShort", "On")
              : providerText(t, "toggleOffShort", "Off")}
          </span>
          {rrEnabled && (
            <StickyCountInput
              value={rrStickyCount}
              disabled={savingRR}
              onCommit={handleChangeStickyCount}
              label={providerText(t, "stickyCountLabel", "Sticky")}
              ariaLabel={providerText(t, "stickyCountAria", "Sticky request count")}
              title={providerText(
                t,
                "stickyCountTooltip",
                "Number of consecutive requests each key serves before rotating to the next one"
              )}
            />
          )}
        </div>
        {/* Provider-level proxy indicator/button */}
        <button
          onClick={() =>
            onSetProxyTarget({
              level: "provider",
              id: providerId,
              label: providerInfo?.name || providerId,
            })
          }
          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all ${
            proxyConfig?.providers?.[providerId]
              ? "bg-amber-500/15 text-amber-500 hover:bg-amber-500/25"
              : "bg-black/[0.03] dark:bg-white/[0.03] text-text-muted/50 hover:text-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"
          }`}
          title={
            proxyConfig?.providers?.[providerId]
              ? t("providerProxyTitleConfigured", {
                  host: proxyConfig.providers[providerId].host || t("configured"),
                })
              : t("providerProxyConfigureHint")
          }
        >
          <span className="material-symbols-outlined text-[14px]">vpn_lock</span>
          {proxyConfig?.providers?.[providerId]
            ? proxyConfig.providers[providerId].host || t("providerProxy")
            : t("providerProxy")}
        </button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {connections.length > 0 && (
          <DistributeProxiesButton
            onDistribute={async () => {
              await handleDistributeProxies();
            }}
            disabled={batchTesting || !!retestingId}
          />
        )}
        {connections.length > 1 && (
          <button
            onClick={handleBatchTestAll}
            disabled={batchTesting || batchRetesting || !!retestingId}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              batchTesting
                ? "bg-primary/20 border-primary/40 text-primary animate-pulse"
                : "bg-bg-subtle border-border text-text-muted hover:text-text-primary hover:border-primary/40"
            }`}
            title={t("testAll")}
            aria-label={t("testAll")}
          >
            <span className="material-symbols-outlined text-[14px]">
              {batchTesting ? "sync" : "play_arrow"}
            </span>
            {batchTesting ? t("testing") : t("testAll")}
          </button>
        )}
        {!isCompatible ? (
          <>
            {isCommandCode ? (
              <>
                <Button
                  size="sm"
                  icon="open_in_new"
                  loading={
                    commandCodeAuthState.phase === "starting" ||
                    commandCodeAuthState.phase === "polling" ||
                    commandCodeAuthState.phase === "applying"
                  }
                  onClick={() => gateConnectionFlow(handleOpenCommandCodeConnect)}
                >
                  Connect
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="add"
                  onClick={() => gateConnectionFlow(openApiKeyAddFlow)}
                >
                  Manual API key
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" icon="add" onClick={() => gateConnectionFlow(openPrimaryAddFlow)}>
                  {providerSupportsPat ? "Add PAT" : t("add")}
                </Button>
                {providerId === "qoder" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => gateConnectionFlow(onOpenOAuthModal)}
                  >
                    Experimental OAuth
                  </Button>
                )}
                {providerId === "codex" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="menu_book"
                    onClick={() => onOpenCodexCliGuide()}
                  >
                    {providerText(t, "codexCliGuideButton", "Codex CLI Guide")}
                  </Button>
                )}
                {providerId === "codex" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="share"
                    onClick={() => gateConnectionFlow(openExternalLinkFlow)}
                  >
                    {providerText(t, "codexExternalLinkButton", "External Codex link")}
                  </Button>
                )}
                {providerId === "codex" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="upload_file"
                    onClick={() => gateConnectionFlow(onOpenImportCodex)}
                  >
                    {typeof (t as any).has === "function" && (t as any).has("importCodexAuth")
                      ? t("importCodexAuth")
                      : "Import auth"}
                  </Button>
                )}
                {providerId === "claude" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="upload_file"
                    onClick={() => gateConnectionFlow(onOpenImportClaude)}
                  >
                    {typeof (t as any).has === "function" && (t as any).has("importClaudeAuth")
                      ? t("importClaudeAuth")
                      : "Import auth"}
                  </Button>
                )}
                {providerId === "grok-cli" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="upload_file"
                    onClick={() => gateConnectionFlow(onOpenImportGrokCli)}
                  >
                    Import auth
                  </Button>
                )}
              </>
            )}
          </>
        ) : (
          connections.length === 0 && (
            <Button size="sm" icon="add" onClick={() => gateConnectionFlow(openApiKeyAddFlow)}>
              {t("add")}
            </Button>
          )
        )}
      </div>
    </div>
  );
}

/**
 * StickyCountInput — number input that commits the new value to the server
 * after a short debounce, on blur, or on Enter. The debounce covers the
 * browser spinner buttons (↑/↓) and arrow keys, which update the value but
 * do NOT fire `onBlur` while focus stays on the input. Without the debounce
 * the user could spin the value up or down and see the displayed number
 * change yet never see the "Sticky count set to N" toast.
 */
const COMMIT_DEBOUNCE_MS = 400;

function StickyCountInput(props: {
  value: number;
  disabled: boolean;
  onCommit: (next: number) => void;
  label: string;
  ariaLabel: string;
  title: string;
}) {
  const { value, disabled, onCommit, label, ariaLabel, title } = props;
  const [draft, setDraft] = useState<string>(String(value));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedRef = useRef<number>(value);
  const lastSyncedValueRef = useRef<number>(value);

  // Sync the local draft when the server-confirmed value changes (e.g. after
  // a successful PUT or when the parent re-loads settings). Guard with a ref
  // so we only update when the prop actually moves — avoids the controlled
  // input "flicker" on every parent re-render.
  useEffect(() => {
    if (value === lastSyncedValueRef.current) return;
    lastSyncedValueRef.current = value;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(String(value));
    lastCommittedRef.current = value;
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, [value]);

  // Cancel any pending debounce when the component unmounts so a stray timer
  // can't fire `onCommit` after teardown.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const commit = (raw: string) => {
    // Cancel any pending debounced commit — this one is authoritative.
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const next = Number(raw);
    if (Number.isFinite(next) && next >= 1 && next <= 1000 && next !== lastCommittedRef.current) {
      lastCommittedRef.current = next;
      onCommit(next);
    } else {
      // Snap back to the last server-confirmed value.
      setDraft(String(lastCommittedRef.current));
    }
  };

  const scheduleCommit = (raw: string) => {
    const next = Number(raw);
    if (!Number.isFinite(next) || next < 1 || next > 1000) return;
    if (next === lastCommittedRef.current) return;
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      // Re-read the input value at fire time, in case the user kept typing.
      commit(String(next));
    }, COMMIT_DEBOUNCE_MS);
  };

  return (
    <>
      <span className="text-text-muted/30 select-none">|</span>
      <span className="material-symbols-outlined text-[14px] text-blue-500">repeat</span>
      <span>{label}</span>
      <input
        type="number"
        min={1}
        max={1000}
        value={draft}
        disabled={disabled}
        onChange={(event) => {
          // Update the local draft immediately so the user sees their typing.
          const raw = event.target.value;
          setDraft(raw);
          // Schedule a debounced commit so spinner clicks and arrow keys
          // (which don't fire onBlur) still get persisted.
          scheduleCommit(raw);
        }}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit((event.target as HTMLInputElement).value);
            (event.target as HTMLInputElement).blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            if (debounceRef.current !== null) {
              clearTimeout(debounceRef.current);
              debounceRef.current = null;
            }
            setDraft(String(value));
            lastCommittedRef.current = value;
            (event.target as HTMLInputElement).blur();
          }
        }}
        className="w-14 rounded border border-border bg-bg px-1.5 py-0.5 text-center text-xs text-text-main outline-none transition-colors focus:border-primary disabled:opacity-60"
        aria-label={ariaLabel}
        title={title}
      />
    </>
  );
}
