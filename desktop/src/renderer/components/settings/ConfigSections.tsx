import type { JSX } from "react";
import { SORT_MODES, TREND_MODES, type SortMode } from "../../lib/controls";
import {
  moveOrderItem,
  sectionProblems,
  toggleDisabled,
  isSectionDirty,
  type SettingsDraft,
  type SettingsSectionKind,
} from "../../lib/settings";
import { EmailListEditor, OrderEditor, ProviderCheckboxes } from "./editors";
import { PillSelect, SectionCard, Toggle, type SectionNotice } from "./fields";
import { NumField, TextField } from "./inputs";
import type { TrendMode } from "../../../shared/ipc.js";

export interface ConfigSectionsProps {
  draft: SettingsDraft;
  baseline: SettingsDraft;
  saving: string | null;
  notices: Record<string, SectionNotice | null>;
  onUpdate: (patch: Partial<SettingsDraft>) => void;
  onSave: (kind: SettingsSectionKind) => void;
}

export function ConfigSections({
  draft,
  baseline,
  saving,
  notices,
  onUpdate,
  onSave,
}: ConfigSectionsProps): JSX.Element {
  function card(kind: SettingsSectionKind, index: string, title: string, children: JSX.Element): JSX.Element {
    return (
      <SectionCard
        index={index}
        title={title}
        file="mystatus.json"
        testId={`section-${kind}`}
        dirty={isSectionDirty(kind, draft, baseline)}
        problems={sectionProblems(kind, draft)}
        saving={saving === kind}
        notice={notices[kind] ?? null}
        onSave={() => onSave(kind)}
      >
        {children}
      </SectionCard>
    );
  }

  return (
    <div className="space-y-5">
      {card(
        "output",
        "01",
        "Output",
        <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
          <PillSelect<SortMode>
            label="Sort"
            options={SORT_MODES}
            value={draft.sort}
            onChange={(sort) => onUpdate({ sort })}
            testPrefix="settings-sort"
          />
          <PillSelect<TrendMode>
            label="Trend"
            options={TREND_MODES}
            value={draft.trend}
            onChange={(trend) => onUpdate({ trend })}
            testPrefix="settings-trend"
          />
          <Toggle
            label="Summary card"
            description="Prepend the account tally / lowest / soonest-reset card"
            checked={draft.summary}
            onChange={(summary) => onUpdate({ summary })}
            testId="settings-summary"
          />
        </div>,
      )}

      {card(
        "polling",
        "02",
        "Sync & history",
        <div className="grid grid-cols-2 gap-x-10 gap-y-4 md:grid-cols-3">
          <NumField
            label="Provider sync"
            value={draft.watchIntervalSec}
            onChange={(watchIntervalSec) => onUpdate({ watchIntervalSec })}
            testId="settings-watch-interval"
            unit="sec"
            min={5}
            hint="Full re-query interval — the TUI clamps below 5s"
          />
          <NumField
            label="UI refresh"
            value={draft.uiRefreshSec}
            onChange={(uiRefreshSec) => onUpdate({ uiRefreshSec })}
            testId="settings-ui-refresh"
            unit="sec"
            min={1}
            hint="Countdown repaint cadence for the live dashboard"
          />
          <NumField
            label="Cache TTL"
            value={draft.cacheTtlSec}
            onChange={(cacheTtlSec) => onUpdate({ cacheTtlSec })}
            testId="settings-cache-ttl"
            unit="sec"
            min={0}
            hint="0 = always live; the cache stays as a failure fallback"
          />
          <NumField
            label="History size"
            value={draft.historyMax}
            onChange={(historyMax) => onUpdate({ historyMax })}
            testId="settings-history-max"
            unit="snaps"
            min={0}
            hint="Trend snapshots retained (ring buffer)"
          />
          <NumField
            label="History interval"
            value={draft.historyMinIntervalSec}
            onChange={(historyMinIntervalSec) => onUpdate({ historyMinIntervalSec })}
            testId="settings-history-interval"
            unit="sec"
            min={0}
            hint="Snapshots taken sooner than this are ignored"
          />
        </div>,
      )}

      {card(
        "providers",
        "03",
        "Providers",
        <div className="space-y-5">
          <ProviderCheckboxes
            disabled={draft.disabled}
            onToggle={(id) => onUpdate({ disabled: toggleDisabled(draft.disabled, id) })}
          />
          <OrderEditor
            order={draft.order}
            onMove={(id, direction) => onUpdate({ order: moveOrderItem(draft.order, id, direction) })}
            onRemove={(id) => onUpdate({ order: draft.order.filter((entry) => entry !== id) })}
            onAdd={(id) => onUpdate({ order: [...draft.order, id] })}
          />
        </div>,
      )}

      {card(
        "google",
        "04",
        "Google accounts",
        <EmailListEditor
          emails={draft.excludeEmails}
          onChange={(excludeEmails) => onUpdate({ excludeEmails })}
        />,
      )}

      {card(
        "antigravity",
        "05",
        "Antigravity Tools",
        <div className="space-y-4">
          <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
            <Toggle
              label="Enabled"
              description="Auto-discovers ~/.antigravity_tools/gui_config.json; disable to force the fallback path"
              checked={draft.agtEnabled}
              onChange={(agtEnabled) => onUpdate({ agtEnabled })}
              testId="settings-agt-enabled"
            />
            <NumField
              label="Usage window"
              value={draft.agtUsageHours}
              onChange={(agtUsageHours) => onUpdate({ agtUsageHours })}
              testId="settings-agt-hours"
              unit="hours"
              min={1}
              hint="Proxy stats period (168 = 7 days)"
            />
            <Toggle
              label="Include usage"
              description="Show proxy token/request totals alongside quota"
              checked={draft.agtIncludeUsage}
              onChange={(agtIncludeUsage) => onUpdate({ agtIncludeUsage })}
              testId="settings-agt-usage"
            />
          </div>
          <TextField
            label="Base URL"
            value={draft.agtBaseUrl}
            onChange={(agtBaseUrl) => onUpdate({ agtBaseUrl })}
            testId="settings-agt-base-url"
            placeholder="http://127.0.0.1:8045/v1"
            hint="Custom/remote instances only — local installs need nothing"
          />
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="API key"
              value={draft.agtApiKey}
              onChange={(agtApiKey) => onUpdate({ agtApiKey })}
              testId="settings-agt-api-key"
              masked
            />
            <TextField
              label="Admin password"
              value={draft.agtAdminPassword}
              onChange={(agtAdminPassword) => onUpdate({ agtAdminPassword })}
              testId="settings-agt-admin-password"
              masked
            />
          </div>
          <p className="text-[11px] text-fog-500">
            Environment variables (<span className="font-mono">ANTIGRAVITY_TOOLS_BASE_URL</span>,{" "}
            <span className="font-mono">_API_KEY</span>, <span className="font-mono">_ADMIN_PASSWORD</span>,{" "}
            <span className="font-mono">_USAGE_HOURS</span>) take precedence over these values — prefer
            env vars for secrets.
          </p>
        </div>,
      )}
    </div>
  );
}
