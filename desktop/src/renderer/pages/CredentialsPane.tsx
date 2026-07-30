import { useState, type JSX } from "react";
import { PaneShell } from "../components/PaneShell";
import type { AuthStatus, CopilotTier, PasteResult } from "../../shared/ipc";
import {
  IDLE,
  MaskedField,
  PresenceBadge,
  SaveBar,
  TextField,
  type PasteSectionState,
} from "../components/PasteFields";

export function CredentialsPane(): JSX.Element {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [copilotToken, setCopilotToken] = useState("");
  const [copilotUsername, setCopilotUsername] = useState("");
  const [copilotTier, setCopilotTier] = useState<CopilotTier>("pro");
  const [copilotState, setCopilotState] = useState<PasteSectionState>(IDLE);

  const [poeKey, setPoeKey] = useState("");
  const [poeState, setPoeState] = useState<PasteSectionState>(IDLE);

  async function loadAuthStatus(): Promise<void> {
    const bridge = window.mystatus;
    if (!bridge) return;
    try {
      setAuthStatus(await bridge.getAuthStatus());
    } catch {
      setAuthStatus({ authJson: [], credentialFiles: [] });
    }
  }

  if (authStatus === null) void loadAuthStatus();

  async function saveCopilot(): Promise<void> {
    const bridge = window.mystatus;
    if (!bridge) {
      setCopilotState({ status: "error", message: "bridge unavailable" });
      return;
    }
    setCopilotState({ status: "saving", message: "Saving…" });
    const res: PasteResult = await bridge.pasteCopilot({
      token: copilotToken,
      username: copilotUsername,
      tier: copilotTier,
    });
    if (res.ok) {
      setCopilotState({ status: "saved", message: "Saved", savedPath: res.path });
      void loadAuthStatus();
    } else {
      setCopilotState({ status: "error", message: res.error });
    }
  }

  async function savePoe(): Promise<void> {
    const bridge = window.mystatus;
    if (!bridge) {
      setPoeState({ status: "error", message: "bridge unavailable" });
      return;
    }
    setPoeState({ status: "saving", message: "Saving…" });
    const res: PasteResult = await bridge.pastePoe({ apiKey: poeKey });
    if (res.ok) {
      setPoeState({ status: "saved", message: "Saved", savedPath: res.path });
      void loadAuthStatus();
    } else {
      setPoeState({ status: "error", message: res.error });
    }
  }

  async function openLink(url: string): Promise<void> {
    const bridge = window.mystatus;
    if (!bridge) return;
    try {
      await bridge.openExternal(url);
    } catch {
      // best-effort; the renderer never imports Electron directly
    }
  }

  return (
    <PaneShell testId="pane-credentials" kicker="Wave 3" title="Credentials">
      <div className="animate-rise max-w-2xl space-y-6">
        <CopilotSection
          token={copilotToken}
          username={copilotUsername}
          tier={copilotTier}
          state={copilotState}
          configured={authStatus?.credentialFiles.includes("copilot-quota-token.json") ?? false}
          oauth={authStatus?.authJson.includes("github-copilot") ?? false}
          onToken={setCopilotToken}
          onUsername={setCopilotUsername}
          onTier={setCopilotTier}
          onSave={saveCopilot}
          onOpenLink={openLink}
        />
        <PoeSection
          apiKey={poeKey}
          state={poeState}
          configured={authStatus?.credentialFiles.includes("poe-api-key.json") ?? false}
          oauth={authStatus?.authJson.includes("poe") ?? false}
          onKey={setPoeKey}
          onSave={savePoe}
          onOpenLink={openLink}
        />
      </div>
    </PaneShell>
  );
}

interface CopilotSectionProps {
  readonly token: string;
  readonly username: string;
  readonly tier: CopilotTier;
  readonly state: PasteSectionState;
  readonly configured: boolean;
  readonly oauth: boolean;
  readonly onToken: (v: string) => void;
  readonly onUsername: (v: string) => void;
  readonly onTier: (v: CopilotTier) => void;
  readonly onSave: () => void;
  readonly onOpenLink: (url: string) => void;
}

function CopilotSection(props: CopilotSectionProps): JSX.Element {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-fog-100">GitHub Copilot — PAT</h2>
        <PresenceBadge configured={props.configured} oauth={props.oauth} />
      </div>
      <p className="mt-2 text-sm leading-relaxed text-fog-300">
        Create a fine-grained PAT with <span className="font-mono text-fog-200">Plan → Read-only</span>{" "}
        scope, then paste it here. Monthly AI-credit allowances: pro 1,500 · pro+ 7,000 · max 20,000.
      </p>
      <div className="mt-4 space-y-3">
        <MaskedField
          label="Token"
          value={props.token}
          onChange={props.onToken}
          placeholder="github_pat_…"
          testId="copilot-token"
        />
        <TextField
          label="Username"
          value={props.username}
          onChange={props.onUsername}
          placeholder="YourGitHubUsername"
          testId="copilot-username"
        />
        <div>
          <label className="block text-xs font-medium text-fog-400">Tier</label>
          <select
            data-testid="copilot-tier"
            value={props.tier}
            onChange={(e) => props.onTier(e.target.value as CopilotTier)}
            className="mt-1 w-full rounded border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-fog-100"
          >
            <option value="pro">pro</option>
            <option value="pro+">pro+</option>
            <option value="max">max</option>
          </select>
        </div>
      </div>
      <SaveBar
        saveTestId="copilot-save"
        linkTestId="copilot-open-link"
        linkUrl="https://github.com/settings/tokens?type=beta"
        linkLabel="Open token settings ↗"
        statusTestId="copilot-status"
        state={props.state}
        onSave={props.onSave}
        onOpenLink={props.onOpenLink}
      />
    </div>
  );
}

interface PoeSectionProps {
  readonly apiKey: string;
  readonly state: PasteSectionState;
  readonly configured: boolean;
  readonly oauth: boolean;
  readonly onKey: (v: string) => void;
  readonly onSave: () => void;
  readonly onOpenLink: (url: string) => void;
}

function PoeSection(props: PoeSectionProps): JSX.Element {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-fog-100">Poe — API key</h2>
        <PresenceBadge configured={props.configured} oauth={props.oauth} />
      </div>
      <p className="mt-2 text-sm leading-relaxed text-fog-300">
        Get a key at <span className="font-mono text-fog-200">poe.com/api_key</span> and paste it here.
        Resolved in priority order: auth.json → <span className="font-mono">POE_API_KEY</span> → this file.
      </p>
      <div className="mt-4 space-y-3">
        <MaskedField
          label="API key"
          value={props.apiKey}
          onChange={props.onKey}
          placeholder="sk-…"
          testId="poe-key"
        />
      </div>
      <SaveBar
        saveTestId="poe-save"
        linkTestId="poe-open-link"
        linkUrl="https://poe.com/api_key"
        linkLabel="Open API key page ↗"
        statusTestId="poe-status"
        state={props.state}
        onSave={props.onSave}
        onOpenLink={props.onOpenLink}
      />
    </div>
  );
}