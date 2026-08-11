// Provider registry mirror for the renderer.
//
// PARITY: plugin/mystatus.ts:7045-7065 (the PROVIDERS registry) — the core's
// array is module-private, so the Settings page hardcodes the same 19 ids
// here. The checkbox list is built from this list; unknown ids found in an
// existing mystatus.json `providers.disabled` are preserved verbatim by the
// settings form (never silently dropped). Re-verify if the core adds or
// renames a provider.

export interface ProviderEntry {
  readonly id: string;
  readonly title: string;
}

export const PROVIDERS: readonly ProviderEntry[] = [
  { id: "anthropic", title: "Anthropic" },
  { id: "atlascloud", title: "AtlasCloud" },
  { id: "byteplus", title: "BytePlus" },
  { id: "copilot", title: "GitHub Copilot" },
  { id: "google", title: "Google" },
  { id: "kimi", title: "Kimi for Coding" },
  { id: "longcat", title: "LongCat" },
  { id: "minimax", title: "MiniMax" },
  { id: "mistral", title: "Mistral" },
  { id: "nanogpt", title: "NanoGPT" },
  { id: "openai", title: "OpenAI" },
  { id: "ollama", title: "Ollama" },
  { id: "opencode-go", title: "OpenCode Go+Zen" },
  { id: "poe", title: "Poe" },
  { id: "qwencloud", title: "QwenCloud" },
  { id: "stepfun", title: "StepFun" },
  { id: "synthetic", title: "Synthetic" },
  { id: "xai", title: "xAI / Grok" },
  { id: "zai", title: "Z.AI" },
];

export const PROVIDER_IDS: readonly string[] = PROVIDERS.map((p) => p.id);
