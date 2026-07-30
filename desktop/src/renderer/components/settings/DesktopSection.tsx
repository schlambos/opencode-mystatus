import type { JSX } from "react";
import {
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  THRESHOLD_STEP,
} from "../../lib/controls";
import {
  isPrefsDirty,
  prefsProblems,
  type DesktopPrefsDraft,
} from "../../lib/settings";
import { FieldLabel, SectionCard, Toggle, type SectionNotice } from "./fields";
import { NumField } from "./inputs";

export interface DesktopSectionProps {
  draft: DesktopPrefsDraft;
  baseline: DesktopPrefsDraft;
  saving: boolean;
  notice: SectionNotice | null;
  onUpdate: (patch: Partial<DesktopPrefsDraft>) => void;
  onSave: () => void;
}

export function DesktopSection({
  draft,
  baseline,
  saving,
  notice,
  onUpdate,
  onSave,
}: DesktopSectionProps): JSX.Element {
  return (
    <SectionCard
      index="06"
      title="Desktop app"
      file="mystatus-desktop.json"
      testId="section-prefs"
      dirty={isPrefsDirty(draft, baseline)}
      problems={prefsProblems(draft)}
      saving={saving}
      notice={notice}
      onSave={onSave}
    >
      <div className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <FieldLabel label="Low-quota mark" />
            <p
              data-testid="prefs-threshold-value"
              className="font-mono text-xs font-semibold text-status-low tabular-nums"
            >
              &lt; {draft.threshold}%
            </p>
          </div>
          <input
            type="range"
            aria-label="Low-quota threshold"
            data-testid="prefs-threshold"
            className="threshold-slider mt-2.5 w-64"
            min={THRESHOLD_MIN}
            max={THRESHOLD_MAX}
            step={THRESHOLD_STEP}
            value={draft.threshold}
            onChange={(event) => onUpdate({ threshold: Number(event.target.value) })}
          />
          <p className="mt-1 text-[11px] text-fog-600">
            Windows below this mark render red and drive low-quota alerts.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Toggle
            label="Low-quota notifications"
            description="Native notification when a window crosses below the mark"
            checked={draft.notifications}
            onChange={(notifications) => onUpdate({ notifications })}
            testId="prefs-notifications"
          />
          <NumField
            label="Notification cooldown"
            value={draft.notifyCooldownMin}
            onChange={(notifyCooldownMin) => onUpdate({ notifyCooldownMin })}
            testId="prefs-cooldown"
            unit="min"
            min={1}
            hint="One notification per provider per cooldown window"
          />
        </div>
        <Toggle
          label="Launch at login"
          description="Open the app in the tray when you sign in"
          checked={draft.launchAtLogin}
          onChange={(launchAtLogin) => onUpdate({ launchAtLogin })}
          testId="prefs-launch-at-login"
        />
        <p className="text-[11px] text-fog-500">
          These settings belong to the desktop app only — they are stored in{" "}
          <span className="font-mono">mystatus-desktop.json</span> and never written to the plugin
          config.
        </p>
      </div>
    </SectionCard>
  );
}
