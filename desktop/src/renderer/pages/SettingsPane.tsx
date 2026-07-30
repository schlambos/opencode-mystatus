import { useEffect, useState, type JSX } from "react";
import type { AntigravityEnvStatus, RevealTarget } from "../../shared/ipc.js";
import { PaneShell } from "../components/PaneShell";
import { ConfigSections } from "../components/settings/ConfigSections";
import { CorruptBanner } from "../components/settings/CorruptBanner";
import { DesktopSection } from "../components/settings/DesktopSection";
import type { SectionNotice } from "../components/settings/fields";
import { getBridge } from "../lib/bridge";
import {
  draftFromConfig,
  prefsDraftFrom,
  sectionPayload,
  type DesktopPrefsDraft,
  type SettingsDraft,
  type SettingsSectionKind,
} from "../lib/settings";
import { reloadConfig, reloadPrefs, useStatusState } from "../lib/store";

type PanePhase =
  | { phase: "loading" }
  | { phase: "bridge-missing" }
  | { phase: "corrupt"; path: string; error: string }
  | { phase: "ready"; path: string };

export function SettingsPane(): JSX.Element {
  const { prefs } = useStatusState();
  const [pane, setPane] = useState<PanePhase>({ phase: "loading" });
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [baseline, setBaseline] = useState<SettingsDraft | null>(null);
  const [prefsDraft, setPrefsDraft] = useState<DesktopPrefsDraft | null>(null);
  const [prefsBaseline, setPrefsBaseline] = useState<DesktopPrefsDraft | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, SectionNotice | null>>({});
  const [commentsAcked, setCommentsAcked] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [envStatus, setEnvStatus] = useState<AntigravityEnvStatus | null>(null);

  async function loadPane(): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
      setPane({ phase: "bridge-missing" });
      return;
    }
    try {
      const status = await bridge.inspectConfig();
      if (status.status === "corrupt") {
        setPane({ phase: "corrupt", path: status.path, error: status.error });
        return;
      }
      setPane({ phase: "ready", path: status.path });
      const config = status.status === "ok" ? status.config : {};
      setDraft(draftFromConfig(config));
      setBaseline(draftFromConfig(config));
      // Env status is independent of mystatus.json — fetch in parallel with the
      // config read so the from-env badges and gui_config discovery line render
      // on first paint. Failures (e.g. bridge missing the handler on older
      // builds) leave envStatus null and the UI shows the "checking…" state.
      bridge
        .getAntigravityEnvStatus()
        .then(setEnvStatus)
        .catch(() => setEnvStatus(null));
    } catch (err) {
      setPane({
        phase: "corrupt",
        path: "",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  useEffect(() => {
    void loadPane();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (prefs === null || prefsDraft !== null) return;
    setPrefsDraft(prefsDraftFrom(prefs));
    setPrefsBaseline(prefsDraftFrom(prefs));
  }, [prefs, prefsDraft]);

  function setNotice(key: string, notice: SectionNotice | null): void {
    setNotices((current) => ({ ...current, [key]: notice }));
  }

  function updateDraft(patch: Partial<SettingsDraft>): void {
    setDraft((current) => (current === null ? current : { ...current, ...patch }));
  }

  function updatePrefs(patch: Partial<DesktopPrefsDraft>): void {
    setPrefsDraft((current) => (current === null ? current : { ...current, ...patch }));
  }

  async function saveSection(kind: SettingsSectionKind): Promise<void> {
    const bridge = getBridge();
    if (!bridge || draft === null) return;
    setSaving(kind);
    setNotice(kind, null);
    try {
      const fresh = await bridge.inspectConfig();
      if (fresh.status === "corrupt") {
        setPane({ phase: "corrupt", path: fresh.path, error: fresh.error });
        return;
      }
      const onDisk = fresh.status === "ok" ? fresh.config : {};
      const merged = await bridge.saveConfigSections(sectionPayload(kind, draft, onDisk));
      setBaseline(draftFromConfig(merged));
      setCommentsAcked(true);
      setNotice(kind, { kind: "saved", text: "Saved" });
      reloadConfig();
    } catch (err) {
      setNotice(kind, {
        kind: "error",
        text: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSaving(null);
    }
  }

  async function savePrefs(): Promise<void> {
    const bridge = getBridge();
    if (!bridge || prefsDraft === null) return;
    setSaving("prefs");
    setNotice("prefs", null);
    try {
      const merged = await bridge.patchPrefs({ ...prefsDraft });
      // Launch-at-login is an OS setting, not just a prefs boolean: mirror the
      // saved value into app.setLoginItemSettings (no-op on Linux). Best-effort
      // — a failure here does not invalidate the prefs save.
      if (prefsDraft.launchAtLogin !== prefsBaseline?.launchAtLogin) {
        try {
          await bridge.setLoginItem({ openAtLogin: prefsDraft.launchAtLogin });
        } catch {
          // The prefs file is the source of truth; the OS flag is best-effort.
        }
      }
      setPrefsBaseline(prefsDraftFrom(merged));
      setNotice("prefs", { kind: "saved", text: "Saved" });
      reloadPrefs();
    } catch (err) {
      setNotice("prefs", {
        kind: "error",
        text: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSaving(null);
    }
  }

  async function resetFile(): Promise<void> {
    const bridge = getBridge();
    if (!bridge) return;
    setResetting(true);
    setResetError(null);
    try {
      const merged = await bridge.resetConfig();
      setDraft(draftFromConfig(merged));
      setBaseline(draftFromConfig(merged));
      setPane((current) => ({
        phase: "ready",
        path: current.phase === "corrupt" ? current.path : "",
      }));
      reloadConfig();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }

  function reveal(target: RevealTarget): void {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge.revealPath(target).catch(() => undefined);
  }

  return (
    <PaneShell testId="pane-settings" kicker="Configuration" title="Settings">
      <div className="max-w-3xl space-y-5">
        {pane.phase === "loading" && (
          <p data-testid="settings-loading" className="animate-blink text-sm text-fog-500">
            Reading mystatus.json…
          </p>
        )}

        {pane.phase === "bridge-missing" && (
          <div
            data-testid="settings-bridge-missing"
            className="rounded-lg border border-status-dead/50 bg-status-dead/10 p-5 text-sm text-status-dead"
          >
            The desktop bridge is unavailable — settings cannot be read or saved.
          </div>
        )}

        {pane.phase === "corrupt" && (
          <CorruptBanner
            error={pane.error}
            path={pane.path}
            resetting={resetting}
            resetError={resetError}
            onReinspect={() => {
              void loadPane();
            }}
            onReset={() => {
              void resetFile();
            }}
          />
        )}

        {pane.phase === "ready" && draft !== null && baseline !== null && (
          <>
            {!commentsAcked && (
              <div
                data-testid="comments-warning"
                className="rounded-md border border-status-warn/40 bg-status-warn/10 px-4 py-2.5 text-xs text-status-warn"
              >
                Saving rewrites <span className="font-mono">mystatus.json</span> as clean JSON —
                comments in the file will be lost (the plugin's own save behaves the same way).
              </div>
            )}

            <ConfigSections
              draft={draft}
              baseline={baseline}
              saving={saving}
              notices={notices}
              envStatus={envStatus}
              onUpdate={updateDraft}
              onSave={(kind) => {
                void saveSection(kind);
              }}
            />

            {prefsDraft !== null && prefsBaseline !== null && (
              <DesktopSection
                draft={prefsDraft}
                baseline={prefsBaseline}
                saving={saving === "prefs"}
                notice={notices["prefs"] ?? null}
                onUpdate={updatePrefs}
                onSave={() => {
                  void savePrefs();
                }}
              />
            )}

            <footer
              data-testid="settings-footer"
              className="rounded-lg border border-ink-700/70 bg-ink-900/60 px-5 py-4"
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-xs break-all text-fog-400">{pane.path}</span>
                <button
                  type="button"
                  data-testid="reveal-config"
                  onClick={() => reveal("config")}
                  className="rounded-md border border-ink-600 bg-ink-950/70 px-2.5 py-1 text-[11px] font-semibold text-fog-300 transition-colors duration-150 hover:border-ink-700 hover:text-fog-100 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
                >
                  Reveal in file manager
                </button>
                <button
                  type="button"
                  data-testid="reveal-prefs"
                  onClick={() => reveal("prefs")}
                  className="rounded-md border border-ink-600 bg-ink-950/70 px-2.5 py-1 text-[11px] font-semibold text-fog-300 transition-colors duration-150 hover:border-ink-700 hover:text-fog-100 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
                >
                  Reveal mystatus-desktop.json
                </button>
              </div>
              <p className="mt-2 text-[11px] text-fog-600">
                OpenCode, the CLI, and the TUI can also write{" "}
                <span className="font-mono">mystatus.json</span> — this page re-reads the file before
                every save.
              </p>
            </footer>
          </>
        )}
      </div>
    </PaneShell>
  );
}
