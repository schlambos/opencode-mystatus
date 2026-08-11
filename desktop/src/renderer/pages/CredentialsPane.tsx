import { useState, type JSX } from "react";
import { PaneShell } from "../components/PaneShell";
import type {
  AuthStatus,
  CaptureResult,
  CaptureWriteFlowResult,
  CopilotTier,
  CredentialFileName,
  PasteResult,
} from "../../shared/ipc";
import {
  IDLE,
  MaskedField,
  PresenceBadge,
  SaveBar,
  TextField,
  type PasteSectionState,
} from "../components/PasteFields";

interface CookieProviderEntry {
  readonly id: string;
  readonly displayName: string;
  readonly fileName: CredentialFileName;
  readonly portalUrl: string;
  readonly helpText: string;
  readonly startUrl: string;
  readonly allowedOrigins: readonly string[];
  readonly idpOrigins: readonly string[];
  readonly sentinelCookies: readonly string[];
  readonly timeoutMs: number;
}

const COOKIE_PROVIDERS: readonly CookieProviderEntry[] = [
  {
    id: "atlascloud",
    displayName: "AtlasCloud",
    fileName: "atlas-cookies.json",
    portalUrl: "https://console.atlascloud.ai",
    startUrl: "https://console.atlascloud.ai",
    allowedOrigins: ["https://console.atlascloud.ai", "https://www.atlascloud.ai"],
    idpOrigins: [
      "https://accounts.google.com",
      "https://github.com",
      "https://login.microsoftonline.com",
      "https://appleid.apple.com",
    ],
    sentinelCookies: ["access-token"],
    timeoutMs: 300_000,
    helpText:
      "Log into https://console.atlascloud.ai. The app captures your session and writes atlas-cookies.json.",
  },
  {
    id: "byteplus",
    displayName: "BytePlus (Ark Coding Plan)",
    fileName: "byteplus-cookies.json",
    portalUrl: "https://console.byteplus.com",
    startUrl: "https://console.byteplus.com",
    allowedOrigins: ["https://console.byteplus.com"],
    idpOrigins: [
      "https://accounts.google.com",
      "https://github.com",
      "https://login.microsoftonline.com",
      "https://appleid.apple.com",
    ],
    sentinelCookies: ["csrfToken"],
    timeoutMs: 300_000,
    helpText: "Log into https://console.byteplus.com. The app captures your session.",
  },
  {
    id: "mistral",
    displayName: "Mistral (Vibe Usage)",
    fileName: "mistral-cookies.json",
    portalUrl: "https://console.mistral.ai",
    startUrl: "https://console.mistral.ai",
    allowedOrigins: ["https://console.mistral.ai"],
    idpOrigins: [
      "https://accounts.google.com",
      "https://github.com",
      "https://login.microsoftonline.com",
      "https://appleid.apple.com",
    ],
    sentinelCookies: ["csrftoken"],
    timeoutMs: 300_000,
    helpText: "Log into https://console.mistral.ai. Multiple accounts merge into the accounts array.",
  },
  {
    id: "ollama",
    displayName: "Ollama Cloud",
    fileName: "ollama-cookies.json",
    portalUrl: "https://ollama.com",
    startUrl: "https://ollama.com/signin",
    allowedOrigins: [
      "https://ollama.com",
      "https://signin.ollama.com",
      "https://auth.ollama.com",
    ],
    idpOrigins: [
      "https://accounts.google.com",
      "https://accounts.youtube.com",
      "https://www.google.com",
      "https://google.com",
      "https://github.com",
      "https://login.microsoftonline.com",
      "https://login.live.com",
      "https://appleid.apple.com",
      "https://api.workos.com",
      "https://signin.workos.com",
      "https://authkit.app",
      "https://authkit.com",
      "https://challenges.cloudflare.com",
    ],
    sentinelCookies: ["__Secure-session"],
    timeoutMs: 300_000,
    helpText:
      "Log into https://ollama.com (WorkOS AuthKit / Google). The app captures your session.",
  },
  {
    id: "longcat",
    displayName: "LongCat API",
    fileName: "longcat-cookies.json",
    portalUrl: "https://longcat.chat/platform/usage",
    startUrl: "https://longcat.chat/platform/usage",
    allowedOrigins: ["https://longcat.chat"],
    idpOrigins: [
      "https://accounts.google.com",
      "https://github.com",
      "https://login.microsoftonline.com",
      "https://appleid.apple.com",
    ],
    sentinelCookies: ["passport_token_key"],
    timeoutMs: 300_000,
    helpText: "Log into https://longcat.chat/platform/usage. The app captures your session.",
  },
  {
    id: "qwencloud",
    displayName: "QwenCloud (Token Plan)",
    fileName: "qwencloud-cookies.json",
    portalUrl: "https://home.qwencloud.com",
    startUrl: "https://home.qwencloud.com",
    allowedOrigins: [
      "https://home.qwencloud.com",
      "https://cs-data.qwencloud.com",
      "https://chat.qwen.ai",
      "https://www.qwen.ai",
    ],
    idpOrigins: [
      "https://account.aliyun.com",
      "https://login.aliyun.com",
      "https://passport.aliyun.com",
      "https://signin.aliyun.com",
    ],
    sentinelCookies: ["login_qwencloud_ticket"],
    timeoutMs: 300_000,
    helpText: "Log into https://home.qwencloud.com. The app captures your session.",
  },
  {
    id: "stepfun",
    displayName: "StepFun (Step Plan)",
    fileName: "stepfun-cookies.json",
    portalUrl: "https://platform.stepfun.ai",
    startUrl: "https://platform.stepfun.ai",
    allowedOrigins: ["https://platform.stepfun.ai"],
    idpOrigins: [
      "https://accounts.google.com",
      "https://github.com",
      "https://login.microsoftonline.com",
      "https://appleid.apple.com",
    ],
    sentinelCookies: ["Oasis-Token"],
    timeoutMs: 300_000,
    helpText: "Log into https://platform.stepfun.ai. The app captures your session.",
  },
  {
    id: "opencode-go",
    displayName: "OpenCode Go+Zen",
    fileName: "opencode-go.json",
    portalUrl: "https://opencode.ai",
    startUrl: "https://opencode.ai",
    allowedOrigins: ["https://opencode.ai"],
    idpOrigins: [
      "https://accounts.google.com",
      "https://github.com",
      "https://login.microsoftonline.com",
      "https://appleid.apple.com",
    ],
    sentinelCookies: ["auth"],
    timeoutMs: 300_000,
    helpText: "Log into https://opencode.ai and open a workspace. Multiple workspaces merge into the accounts array.",
  },
];

export function CredentialsPane(): JSX.Element {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [copilotToken, setCopilotToken] = useState("");
  const [copilotUsername, setCopilotUsername] = useState("");
  const [copilotTier, setCopilotTier] = useState<CopilotTier>("pro");
  const [copilotState, setCopilotState] = useState<PasteSectionState>(IDLE);

  const [poeKey, setPoeKey] = useState("");
  const [poeState, setPoeState] = useState<PasteSectionState>(IDLE);

  const [captureState, setCaptureState] = useState<Record<string, PasteSectionState>>({});

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

  async function captureProvider(provider: CookieProviderEntry): Promise<void> {
    const bridge = window.mystatus;
    if (!bridge) {
      setCaptureState((s) => ({
        ...s,
        [provider.id]: { status: "error", message: "bridge unavailable" },
      }));
      return;
    }
    setCaptureState((s) => ({
      ...s,
      [provider.id]: {
        status: "saving",
        message: "Complete sign-in in the login window…",
      },
    }));
    const capture: CaptureResult = await bridge.capture({
      partitionId: `mystatus-${provider.id}`,
      startUrl: provider.startUrl,
      allowedOrigins: provider.allowedOrigins,
      idpOrigins: provider.idpOrigins,
      sentinelCookies: provider.sentinelCookies,
      timeoutMs: provider.timeoutMs,
    });
    if (capture.status !== "ok") {
      setCaptureState((s) => ({
        ...s,
        [provider.id]: {
          status: "error",
          message: capture.detail ?? `capture ${capture.status}`,
        },
      }));
      return;
    }
    setCaptureState((s) => ({
      ...s,
      [provider.id]: { status: "saving", message: "Writing + testing…" },
    }));
    const flow: CaptureWriteFlowResult = await bridge.processCapture(provider.id, capture);
    if (flow.ok) {
      const testMsg = flow.test.ok ? "Saved · connection OK" : `Saved · ${flow.test.error}`;
      setCaptureState((s) => ({
        ...s,
        [provider.id]: { status: "saved", message: testMsg, savedPath: flow.writePath },
      }));
      void loadAuthStatus();
      void bridge.refresh();
    } else {
      setCaptureState((s) => ({
        ...s,
        [provider.id]: { status: "error", message: `${flow.stage}: ${flow.error}` },
      }));
    }
  }

  return (
    <PaneShell testId="pane-credentials" kicker="Wave 3" title="Credentials">
      <div className="animate-rise max-w-2xl space-y-6">
        <CookieCaptureSection
          providers={COOKIE_PROVIDERS}
          states={captureState}
          configuredFiles={authStatus?.credentialFiles ?? []}
          onCapture={captureProvider}
          onOpenLink={openLink}
        />
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

interface CookieCaptureSectionProps {
  readonly providers: readonly CookieProviderEntry[];
  readonly states: Record<string, PasteSectionState>;
  readonly configuredFiles: readonly string[];
  readonly onCapture: (provider: CookieProviderEntry) => void;
  readonly onOpenLink: (url: string) => void;
}

function CookieCaptureSection(props: CookieCaptureSectionProps): JSX.Element {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-6">
      <h2 className="text-base font-semibold text-fog-100">Cookie-based providers</h2>
      <p className="mt-2 text-sm leading-relaxed text-fog-300">
        Sign in to each provider in an isolated in-app window. The app captures your session
        cookies, writes the credential file, and tests the connection. Re-capture when a card
        stops rendering.
      </p>
      <ul className="mt-4 space-y-3">
        {props.providers.map((provider) => {
          const state = props.states[provider.id] ?? IDLE;
          const configured = props.configuredFiles.includes(provider.fileName);
          return (
            <li
              key={provider.id}
              className="flex items-center justify-between gap-3 rounded border border-ink-700 bg-ink-800 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-fog-100">{provider.displayName}</span>
                  <PresenceBadge configured={configured} oauth={false} />
                </div>
                <p className="mt-1 truncate text-xs text-fog-500">{provider.helpText}</p>
                {state.savedPath !== undefined && state.status === "saved" && (
                  <p className="mt-1 truncate font-mono text-xs text-fog-500">{state.savedPath}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  data-testid={`capture-${provider.id}`}
                  onClick={() => props.onCapture(provider)}
                  className="rounded bg-fog-100 px-3 py-1.5 text-xs font-medium text-ink-900 hover:bg-fog-200"
                >
                  {state.status === "saving" ? "…" : "Sign in"}
                </button>
                <button
                  data-testid={`capture-${provider.id}-link`}
                  onClick={() => props.onOpenLink(provider.portalUrl)}
                  className="rounded border border-ink-600 px-3 py-1.5 text-xs text-fog-300 hover:border-fog-400"
                >
                  ↗
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}