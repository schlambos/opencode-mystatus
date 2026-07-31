<h1 align="center">opencode-mystatus</h1>

<p align="center">
  <strong>All your AI usage, in one glance.</strong><br>
  A unified quota &amp; spend dashboard for <a href="https://opencode.ai">OpenCode</a> — sixteen providers, one command.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://opencode.ai"><img src="https://img.shields.io/badge/OpenCode-plugin-black.svg" alt="OpenCode Plugin"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A518-3c873a.svg" alt="Node >= 18">
</p>

<p align="center">
  <em>Fork of <a href="https://github.com/vbgate/opencode-mystatus">vbgate/opencode-mystatus</a>. Not published to npm — install from this repo.</em>
</p>

---

Subscriptions pile up — ChatGPT, Claude, Gemini, Copilot, Grok, and a handful of API plans — and every one of them has its own dashboard, its own reset clock, and its own way of telling you you're out. **opencode-mystatus** pulls them all together. It reads the credentials OpenCode already stores, asks each provider how much you have left, and renders one clean, sorted, at-a-glance report — right inside your terminal.

```
/mystatus
```

## Why you'll want it

- **Never get surprised by a limit again.** See what's running low *before* it blocks you, with projected "time to empty" estimates.
- **One place for everything.** Sixteen providers, multiple accounts each, in a single scrollable view.
- **Zero busywork for OAuth and Antigravity Tools.** Signed-in OpenCode accounts are picked up automatically, and a local Antigravity Tools install is discovered from `~/.antigravity_tools/gui_config.json`; cookie-based providers (AtlasCloud, BytePlus, LongCat, Ollama, QwenCloud, StepFun, OpenCode Go+Zen) need a one-time browser session capture.
- **Built for the terminal.** Responsive cards that size to your window, color-coded bars, and a summary up top.

## Highlights

- 🧭 **Summary card** — account tally, your lowest window, and the next thing to reset, right at the top.
- 🚦 **Urgency-first ordering** — whatever's closest to empty floats to the top (or sort by name / reset time).
- 📈 **Usage trends** — color-coded sparklines (green/yellow/red per data point), deltas, and *"~Xm to empty"* projection drawn from your own history.
- 🟩 **Color-coded at a glance** — emoji + ANSI bars (🟥 ≤0 · 🟧 <25 · 🟨 <50 · 🟩 ≥50) that survive even when ANSI is stripped.
- 📐 **Responsive layout** — single-column cards that resize to your terminal and never wrap.
- 💸 **Spend insight** — OpenCode Zen per-model cost breakdowns and balances alongside quota.
- 🛟 **Resilient** — automatic retries, a cache fallback when a provider is flaky, and graceful per-provider errors.
- 🤖 **Scriptable** — `format: json` for machine-readable output.
- 🏃 **Standalone CLI** — run `mystatus` or `usage` from any terminal, no OpenCode session needed.
- 📺 **Live dashboard** — `mystatus --watch` opens a full-screen TUI with Current / Weekly / Monthly views, live countdowns, and a 60s refresh cycle.

## What it looks like

A single-column stack of cards, sorted by urgency, with a summary on top and low-quota alerts at the bottom. Every supported provider rendered with representative data (sort by name shown for full coverage):

```text
╭─ Summary ────────────────────────────────────────────────────────╮
│                                                                  │
│  Accounts:       16   🟩 8  🟨 3  🟧 2  🟥 1                     │
│  Lowest:         MiniMax Token Plan · 5-hour  3%                 │
│  Soonest reset:  BytePlus Coding Plan · Session  0m              │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ Anthropic Account Quota ────────────────────────────────────────╮
│                                                                  │
│  Account:        Claude Pro/Max                                  │
│                                                                  │
│  5-hour limit                                                    │
│  🟨 ███████████████████████░░░░░░░░░░░░░░░░░░░░░░ 49% remaining  │
│     → 0% ▆▆▆▄▄▄▄▄▄▄                                              │
│  Resets in: 1h 10m                                               │
│                                                                  │
│  7-day limit                                                     │
│  🟩 █████████████████████████████████░░░░░░░░░░░░ 72% remaining  │
│     → 0% ▆▆▆▅▅▅▅▅▅▅                                              │
│  Resets in: 4d 7h 50m                                            │
│                                                                  │
│  7-day (Fable)                                                   │
│  🟩 ███████████████████████████████████████████░░ 98% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Resets in: 4d 7h 50m                                            │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ AtlasCloud Coding Plan ─────────────────────────────────────────╮
│                                                                  │
│  Account:        user@example.com                                │
│  Plan:           AtlasCloud Lite ($20/monthly)                   │
│  Status:         active                                          │
│                                                                  │
│  Weekly plan cap                                                 │
│  🟩 ██████████████████████████████████████████░░░ 94% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Used this week: 1,980,000 / 33,000,000 credits                  │
│  Resets in: 2d 2h                                                │
│                                                                  │
│  Monthly plan total                                              │
│  🟩 ██████████████████████████████████████░░░░░░░ 84% remaining  │
│  Used: 10,560,000 / 66,000,000 credits                           │
│  Resets in: 29d 23h                                              │
│                                                                  │
│  Plan expires:   29d 23h 29m (2026-08-18)                       │
│  Cookie expires:       6d 8h 12m (2026-06-24)                    │
│                                                                  │
│  Recent calls (last 24h, 18 total, top 5):                       │
│    21:34  deepseek-ai/deepseek-v4-pro         5in/  58out  -348  │
│    21:34  deepseek-ai/deepseek-v4-pro         5in/  98out  -578  │
│    21:31  deepseek-ai/deepseek-v4-pro     14402in/  84out  -41…  │
│    21:31  deepseek-ai/deepseek-v4-pro     14078in/ 141out  -41…  │
│    21:31  deepseek-ai/deepseek-v4-pro     13801in/ 130out  -40…  │
│    (top-5 24h burn: -124,313)                                    │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ BytePlus Coding Plan ───────────────────────────────────────────╮
│                                                                  │
│  Plan:           BytePlus Ark Coding Plan                        │
│  Status:          Running                                        │
│                                                                  │
│  Session                                                         │
│  🟩 ████████████████████████████████████████████ 100% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Resets in: resetting                                            │
│                                                                  │
│  Weekly                                                          │
│  🟩 ████████████████████████████████░░░░░░░░░░░░░ 70% remaining  │
│     ▼3%/2h ▆▆▆▆▆▆▆▅▅▅                                            │
│  Resets in: 3d 18h 50m                                           │
│                                                                  │
│  Monthly                                                         │
│  🟩 ██████████████████████████████████████░░░░░░░ 83% remaining  │
│     → 0% ▆▆▆▆▆▆▆▆▆▆                                              │
│  Resets in: 25d 18h 50m                                          │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ GitHub Copilot Account Quota ───────────────────────────────────╮
│                                                                  │
│  Account:        GitHub Copilot (@johndoe)                       │
│  Plan:           pro                                             │
│                                                                  │
│  Monthly AI credits                                              │
│  🟨 ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░ 44% remaining  │
│     ▼1%/4h ▆▆▆▆▆▅▅▅▅▄                                            │
│  Used: 840 / 1,500 credits                                       │
│  Resets in: 12d 8h                                               │
│  By model: GPT-5.3-Codex 710 · Claude Sonnet 5 130               │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ Google — johndoe@gmail.com ─────────────────────────────────────╮
│                                                                  │
│  Gemini Pro                                                      │
│  🟩 ███████████████████████████████████████████░░ 97% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Resets in: 47m                                                  │
│                                                                  │
│  Gemini Flash                                                    │
│  🟩 ███████████████████████████████████████████░░ 97% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Resets in: 47m                                                  │
│                                                                  │
│  Claude                                                          │
│  🟩 ████████████████████████████████████████░░░░░ 88% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▆▆                                              │
│  Resets in: 4h 44m                                               │
│                                                                  │
│  GPT-OSS                                                         │
│  🟩 ████████████████████████████████████████░░░░░ 88% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▆▆                                              │
│  Resets in: 4h 44m                                               │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ Google — janedoe@gmail.com ─────────────────────────────────────╮
│                                                                  │
│  Gemini Pro                                                      │
│  🟥 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0% remaining  │
│     → 0% ▁▁▁▁▁▁▁▁▁▁                                              │
│  Resets in: 2d 2h 11m                                            │
│                                                                  │
│  Claude                                                          │
│  🟥 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▁▁                                              │
│  Resets in: 6d 23h 45m                                           │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ LongCat API Quota ───────────────────────────────────────────────╮
│                                                                  │
│  Account:        user@example.com                                │
│  Plan:           LongCat API                                     │
│  Active API keys: 3                                              │
│                                                                  │
│  Free quota                                                      │
│  🟧 ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 11% remaining  │
│     ▼8%/2h ▅▄▄▄▄▄▄▄▄                                            │
│  Used:           4,429,544 / 5,000,000                           │
│                                                                  │
│  Total tokens                                                    │
│  🟩 ████████████████████░░░░░░░░░░░░░░░░░░░░░░░ 78% remaining  │
│     → 0% ▆▆▆▆▆▆▆▆▆▆                                              │
│  Used:           4,429,544 / 20,000,000                          │
│                                                                  │
│  Fuel packages:  3 active · 15,000,000 tokens remaining          │
│  Nearest expiry: 27d                                             │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ MiniMax Token Plan ─────────────────────────────────────────────╮
│                                                                  │
│  General (unified pool) — 5h                                     │
│  🟧 █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 3% remaining │
│     ▼12%/30m ▅▄▃▂▂▁▁▁▁▁                                          │
│  Used: 4,850 / 5,000                                             │
│  Resets in: 1h 0m                                                │
│                                                                  │
│  General (unified pool) — 7-day                                  │
│  🟩 █████████████████████████████████████████████ 99% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Used: 350 / 50,000                                              │
│  Resets in: 4d 5h                                                │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ Mistral Vibe Usage ─────────────────────────────────────────────╮
│                                                                  │
│  ── johndoe@example.com (johndoe) ──                             │
│  Monthly Vibe budget                                             │
│  🟩 ███████████████████████████████████████████░░ 96% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Resets in: 13d 2h 50m                                           │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ NanoGPT Account Quota ──────────────────────────────────────────╮
│                                                                  │
│  Auth source:     OpenCode native auth                           │
│  Balance:        $3.27                                           │
│  Plan:           Subscription (stripe)                           │
│                                                                  │
│  Weekly input tokens                                             │
│  🟨 ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░ 44% remaining  │
│     ▼5%/6h ▆▅▅▅▄▄▄▄▄▄                                            │
│  Used: 33.6M / 60M                                               │
│  Resets in: 4d 2h 50m                                            │
│                                                                  │
│  Daily images                                                    │
│  🟩 █████████████████████████████████████████░░░░ 91% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Used: 9 / 100                                                   │
│  Resets in: 2h 50m                                               │
│                                                                  │
│  Renews:         17d 19h 28m                                     │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ OpenAI Account Quota ───────────────────────────────────────────╮
│                                                                  │
│  Account:        johndoe@gmail.com                               │
│  Plan:           ChatGPT plus                                    │
│                                                                  │
│  5-hour limit                                                    │
│  🟩 ████████████████████████████░░░░░░░░░░░░░░░░░ 60% remaining  │
│     → 0% ▇▇▇▇▇▇▆▄▅▅                                              │
│  Resets in: 4h 26m                                               │
│                                                                  │
│  7-day limit                                                     │
│  🟨 █████████████████████░░░░░░░░░░░░░░░░░░░░░░░░ 47% remaining  │
│     ▼1%/1h ▄▄▄▄▄▄▄▄▄▄                                            │
│  Resets in: 18h 27m                                              │
│                                                                  │
│  GPT-5.3-Codex-Spark — 7-day limit                               │
│  🟩 █████████████████████████████████████░░░░░░░░ 82% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Resets in: 5d 18h                                               │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ OpenCode Go+Zen Account Quota ──────────────────────────────────╮
│                                                                  │
│  ── personal ──                                                  │
│  Rolling                                                         │
│  🟩 ███████████████████████████████████████░░░░░░ 85% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Resets in: 4h 12m                                               │
│                                                                  │
│  Weekly                                                          │
│  🟨 ███████████████████████░░░░░░░░░░░░░░░░░░░░░░ 50% remaining  │
│     ▼2%/8h ▅▅▅▅▄▄▄▄▄▄                                            │
│  Resets in: 3d 14h                                               │
│                                                                  │
│  Monthly plan points                                             │
│  🟩 ████████████████████████████████░░░░░░░░░░░░░ 71% remaining  │
│     → 0% ▆▆▆▆▆▆▆▆▆▆                                              │
│  Resets in: 21d 6h                                               │
│                                                                  │
│  Zen balance:    $12.40                                          │
│  Payment:        Visa •• 4242                                    │
│  Monthly spend:  $7.60                                           │
│                                                                  │
│  Zen spend:      $7.60 across 6 models                           │
│    claude-sonnet-4-6       $4.1230 (842)                         │
│    gpt-5.1                 $1.8420 (314)                         │
│    grok-4.20               $0.9650 (188)                         │
│    deepseek-v3.2           $0.4870 (122)                         │
│    glm-4.6                 $0.1830 ( 41)                         │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ Ollama Cloud ───────────────────────────────────────────────────╮
│                                                                  │
│  Account:        user@example.com                                │
│  Plan:           Ollama pro                                      │
│                                                                  │
│  Session                                                         │
│  🟩 ████████████████████████████████████████████░ 99% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Used: 0.5%                                                      │
│  Resets in: 1h                                                   │
│                                                                  │
│  Weekly                                                          │
│  🟩 ████████████████████████████████████████████░ 99% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Used: 0.2%                                                      │
│  Resets in: 1d 12h                                               │
│                                                                  │
│  Subscription renews: July 19, 2026                              │
│  Extra usage balance: $0                                         │
│                                                                  │
│  Session models:                                                 │
│    nemotron-3-ultra: 7 requests                                  │
│    glm-5: 3 requests                                             │
│  Weekly models:                                                  │
│    nemotron-3-ultra: 8 requests                                  │
│    deepseek-v4-pro: 1 request                                    │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ Poe Account Quota ──────────────────────────────────────────────╮
│                                                                  │
│  Balance:        687,420 pts ($16.50 USD)                        │
│  Daily grant:    +3,000 (Resets in: 4h 32m)                      │
│                                                                  │
│  Monthly                                                         │
│  🟨 █████████████████████░░░░░░░░░░░░░░░░░░░░░░░░ 46% remaining  │
│     ▼1%/3h ▅▅▅▅▅▅▄▄▄▄                                            │
│  Plan points: 687,420 / 1,500,000                                │
│  Resets in: 11d 18h                                              │
│                                                                  │
│  Add-on points:  120,000                                         │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ QwenCloud Token Plan ───────────────────────────────────────────╮
│                                                                  │
│  Plan:           Token Plan Team Edition (standard, 1 seat)      │
│  Auto-renew:     enabled                                         │
│                                                                  │
│  Credits                                                         │
│  🟩 ████████████████████████████████░░░░░░░░░░░░░ 72% remaining  │
│     → 0% ▆▆▆▆▆▆▆▆▆▆                                              │
│  Used: 7,050 / 25,000                                            │
│  Resets in: 23d 16h 6m                                           │
│                                                                  │
│  Cycle:          Jun 11 — Jul 11                                 │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ StepFun Token Plan ─────────────────────────────────────────────╮
│                                                                  │
│  Plan:           Plus                                            │
│  Renews:          29d 3h 55m                                     │
│  Price:           $9.99/mo                                       │
│                                                                  │
│  5-hour rolling                                                  │
│  🟩 ████████████████████████████████████████████ 100% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Resets in: resetting                                            │
│                                                                  │
│  Weekly                                                          │
│  🟩 ███████████████████████████████████████████░░ 95% remaining  │
│     → 0% ▇▇▇▇▇▇▇▇▇▇                                              │
│  Resets in: 1d 6h 50m                                            │
│                                                                  │
│  Models:         step-3.5-flash, step-3.5-flash-2603, stepaudi…  │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ xAI/Grok ───────────────────────────────────────────────────────╮
│                                                                  │
│  Auth:           valid                                           │
│  Token expires:  2h 39m                                          │
│                                                                  │
│  Weekly SuperGrok limit                                          │
│  🟧 ██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 22% remaining  │
│     → 0% ▂▂▂▂▂▂                                                  │
│  Weekly usage: 77.59% used · Resets Jul 26                       │
│  By product: API 25.59% · Build 51.19% · Chat 0.00% · Imagine 0… │
│  Separate monthly billing: $116.39 / $150.00 (reference only)    │
│  Resets in: 6d 2h 50m                                            │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

╭─ Z.AI Coding Plan ───────────────────────────────────────────────╮
│                                                                  │
│  Plan:           GLM Coding Pro                                  │
│  Price:           $30.00/month                                   │
│  Valid:           Jun 01 to Jul 01                               │
│  Auto-renews:     2026-07-01                                     │
│                                                                  │
│  5-hour rolling                                                  │
│  🟨 ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░ 44% remaining  │
│     ▼3%/30m ▅▅▅▄▄▄▄▄▄▄                                           │
│  Used: 280 / 500                                                 │
│  Resets in: 3h 12m                                               │
│                                                                  │
│  Weekly                                                          │
│  🟩 ██████████████████████████████████░░░░░░░░░░░ 76% remaining  │
│     → 0% ▆▆▆▆▆▆▆▆▆▆                                              │
│  Used: 720 / 3,000                                               │
│    glm-4.6: 540, glm-4.5: 180                                    │
│  Resets in: 4d 19h                                               │
│                                                                  │
│  Monthly MCP / tool calls                                        │
│  🟩 █████████████████████████████████████░░░░░░░░ 82% remaining  │
│     → 0% ▆▆▆▆▆▆▆▆▆▆                                              │
│  Used: 5,400 / 30,000                                            │
│  Resets in: 13d 6h                                               │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯

⚠️ Low quota alerts:
  • LongCat API Quota · Free quota: 11%
  • MiniMax Token Plan · 5-hour: 3%
  • xAI/Grok: 22%
  • Google — janedoe@gmail.com: 0%
```

Sort by `urgency` (default), `name`, or `reset`. Hide specific providers with `exclude=poe,longcat` (or persist in `mystatus.json`).

### Providers that need a browser session token

Some providers don't expose a public usage API. The card only renders if you capture your authenticated browser session and save it as JSON under `~/.config/opencode/`. Without the file the provider is skipped silently.

| Provider | Config file | Required values | Why |
|---|---|---|---|
| **AtlasCloud** | `~/.config/opencode/atlas-cookies.json` | `{ "cookie": "<full Cookie header string from console.atlascloud.ai including access-token=…>", "accountUuid": "<optional, auto-resolved via /current-user>" }` | No public usage REST API — plugin reads the console's authenticated dashboard API. Coding-plan `apikey-…` cannot read usage. |
| **BytePlus** | `~/.config/opencode/byteplus-cookies.json` | `{ "cookie": "<full Cookie header string from console.byteplus.com>" }` | No public usage REST API — plugin scrapes the internal dashboard API. |
| **Mistral** | `~/.config/opencode/mistral-cookies.json` | `{ "cookie": "<full Cookie header from console.mistral.ai including csrftoken=…>" }` (also supports `{ "accounts": [...] }`) | The Vibe monthly-budget percentage is exposed by the authenticated console, not a normal inference API key. |
| **Ollama** | `~/.config/opencode/ollama-cookies.json` | `{ "cookie": "<full Cookie header from ollama.com including __Secure-session=…>" }` | No account usage REST API — plugin scrapes `ollama.com/settings` SSR. Inference API keys cannot read quota. |
| **LongCat** | `~/.config/opencode/longcat-cookies.json` | `{ "passportToken": "<passport_token_key>", "region": "2" }` or `{ "cookie": "passport_token_key=…; long_cat_region_key=2; …" }` | Inference `ak_…` keys in `opencode.json` run models only — quota lives on the platform portal (`passport_token_key` + `long_cat_region_key` cookies). |
| **QwenCloud** | `~/.config/opencode/qwencloud-cookies.json` | `{ "ticket": "<login_qwencloud_ticket>", "aliyunPk": "<login_aliyunid_pk>", "isg": "<isg>", "esmTicket": "<login_ESM_account_ticket>" }` (`esmTicket` optional) | No public usage REST API — plugin reads the Aliyun BSS console API. |
| **StepFun** | `~/.config/opencode/stepfun-cookies.json` | `{ "oasisToken": "<Oasis-Token>", "oasisWebid": "<Oasis-Webid>", "sessionToken": "<__Secure-next-auth.session-token>" }` | No public usage REST API — plugin hits the dashboard's internal tRPC API. |
| **OpenCode Go+Zen** | `~/.config/opencode/opencode-go.json` | `{ "workspaceId": "...", "authCookie": "<auth cookie from opencode.ai>" }` (multi-account form: `{ "accounts": [ { "id": "...", "workspaceId": "...", "authCookie": "..." } ] }`) | API key alone only confirms reachability. Quota windows + Zen balance/spend come from authenticated workspace dashboard SSR. |

All session tokens expire periodically — re-capture and overwrite when the card stops rendering. Files are read-only to the plugin and never transmitted anywhere except the provider's own host.

## Supported providers

| Provider | Account type | What you see |
|---|---|---|
| **Anthropic** | Claude Pro / Max | Dynamic 5-hour, weekly, model/surface limits (including Fable), plus usage-credit spend/caps when enabled |
| **AtlasCloud** | Monthly subscription or pay-go pack | Independent weekly + full-cycle caps, every active stacked pack, plan/cookie expiry, and recent-call log; legacy daily plans remain supported |
| **BytePlus** | Ark Coding Plan | Plan details + rolling / weekly / monthly windows |
| **GitHub Copilot** | Individual / Business / Enterprise | Current monthly AI-credit usage for PAT-backed individual plans, pooled-organization usage without a fabricated per-user remainder, legacy premium requests, and every OAuth quota snapshot |
| **Google** | Antigravity / Google AI Pro | With Antigravity Tools: Gemini + Claude/GPT 5-hour and weekly quota, reset times, account status, and proxy token/request usage. Falls back to auth-plugin Gemini Pro / Flash / Claude / GPT-OSS quota. |
| **LongCat** | API token quota (`ak_…` in `opencode.json`) | Account email, active API key count, **free quota** (blocks inference when empty), **total tokens** (incl. fuel packs), fuel-package expiry |
| **MiniMax** | Token Plan | Unified 5-hour + weekly plan windows (with compatibility for older named capability buckets) |
| **Mistral** | Vibe plan | Monthly Vibe budget and reset per configured account |
| **NanoGPT** | Balance + subscription | USD/XNO balance plus every returned legacy daily/monthly operation pool and newer weekly-token/daily-image pool |
| **OpenAI** | ChatGPT Plus / Team / Pro | General, code-review, and named model/product quotas (for example GPT-5.3-Codex-Spark), reset credits, credit balance/message estimates, and spend controls |
| **Ollama** | Cloud Pro / Max | Session & weekly GPU-time windows, per-model request breakdown, renewal date |
| **OpenCode Go+Zen** | Any Go subscription | Rolling/weekly/monthly quota **+** Zen balance & per-model spend |
| **Poe** | Subscription or pay-go | Authoritative total points/USD balance and grants; a monthly percentage only when the API separately reports plan-only points |
| **QwenCloud** | Token Plan (Team Edition) | Credits remaining + cycle dates |
| **StepFun** | Step Plan (Flash Mini/Plus/Pro/Max) | Plan details + the 5-hour pool and any weekly pool actually returned by the dashboard API |
| **xAI / Grok** | SuperGrok | Shared weekly usage pool, reset time, per-product breakdown (API, Build, Chat, Imagine, Voice), and extra-usage credits |
| **Z.AI** | GLM Coding Plan | 5-hour + weekly prompt pools and distinctly labeled monthly MCP/tool-call quotas with model/tool breakdowns |

Providers you aren't signed into are skipped silently — you only ever see what's relevant to you.


## Installation

This fork is **not on npm** — install directly from this repo.

### From source (recommended)

```bash
git clone https://github.com/schlambos/opencode-mystatus.git ~/opencode-plugins/opencode-mystatus
cd ~/opencode-plugins/opencode-mystatus
npm install         # or: bun install
npm run build       # produces dist/plugin/mystatus.js
```

Then either:

**A. Drop the files in place** (simplest):

```bash
cp plugin/mystatus.ts ~/.config/opencode/plugin/
cp command/mystatus.md command/usage.md ~/.config/opencode/command/
cp bin/mystatus bin/mystatus-cli.ts ~/.local/bin/
chmod +x ~/.local/bin/mystatus
ln -sf ~/.local/bin/mystatus ~/.local/bin/usage
```

**B. Or reference the built dist via `file://` from `opencode.json`**:

```json
{
  "plugin": [
    "file:///absolute/path/to/opencode-mystatus/dist/plugin/mystatus.js"
  ],
  "command": {
    "mystatus": {
      "description": "Query quota usage for all AI accounts",
      "template": "Use the mystatus tool to query quota usage. Output is a single-column stack of provider cards — if you know the user's terminal width, pass it as the `width` argument so the cards size to the terminal and never wrap. Wrap the entire returned output in a single fenced ```text code block so the box-drawing borders and alignment are preserved exactly."
    }
  }
}
```

Restart OpenCode and run `/mystatus`.

## Standalone CLI

The plugin ships with a terminal CLI so you can check your quotas without launching OpenCode at all. It uses `bun` to call the same core logic directly.

```bash
mystatus                    # all providers, ANSI
mystatus --only longcat     # single provider
mystatus --only openai      # single provider
mystatus --format json      # machine-readable
mystatus --trend full       # with projections
mystatus --fresh            # bypass cache
mystatus --help             # all options
```

### Live dashboard

`mystatus --watch` opens a full-screen terminal dashboard — separate from the one-shot card output. It is optimized for **at-a-glance scanning**: one provider block at a time, bucket label on its own line, meter underneath, sorted by what's lowest.

```bash
mystatus --watch
mystatus --watch --interval 60    # provider sync interval (default 60s)
mystatus --watch --trend full     # trends still feed history; one-shot output unchanged
```

#### Three views

Press `1`, `2`, `3`, or `Tab` to switch. Each view shows a different time horizon — not three copies of the same list.

| View | Key | What it shows |
|------|-----|----------------|
| **Current** | `1` | What you have left **right now**. Short-term windows (5h, session, daily) when present. If a provider only has weekly or monthly/credits quotas, those appear here too — that's its actionable quota (for example, SuperGrok's weekly pool). **Every configured provider appears on this tab.** |
| **Weekly** | `2` | Every 7-day and weekly window, including weekly-only providers such as Grok. |
| **Monthly** | `3` | Monthly and billing-cycle windows — **only for providers that also have shorter tiers**. Credits-only providers stay on Current. |

Reset countdowns tick every second between provider syncs. Press `r` to force a refresh, `q` to quit.

Configure in `~/.config/opencode/mystatus.json`:

```json
"watchIntervalSec": 60,
"uiRefreshSec": 1,
"cacheTtlSec": 60
```

Pairing `cacheTtlSec` with `watchIntervalSec` reduces redundant API calls.

#### Keys

| Key | Action |
|-----|--------|
| `1` / `2` / `3` | Switch Current / Weekly / Monthly |
| `Tab` | Cycle views |
| `e` | Toggle Issues pane (stale data, failures, not-configured providers) |
| `x` | Hide the provider at the cursor (quota pane) or show it again (hidden pane) |
| `d` | Cycle density: auto / detail / compact |
| `j` / `k` or arrows | Scroll |
| `space` / `b` | Page down / up |
| `g` / `G` | Jump to top / bottom |
| `r` | Force sync |
| `q` | Quit |

#### Hiding providers

Press `x` on any provider in the quota panes to hide it from the list. Hidden providers are still queried in the background (so their data stays fresh when you unhide them), but they are filtered from the Current, Weekly, and Monthly views. A `x Hidden N` tab appears in the tab bar when any providers are hidden.

To manage hidden providers, press `x` when the `Hidden` tab is active (or navigate to it by pressing `x` from the quota pane after hiding at least one provider). The hidden pane lists all hidden providers with their names. Press `x` on any entry to show it again.

Hidden state is persisted to `~/.config/opencode/mystatus.json` under `providers.hidden` (an array of provider names, case-insensitive). This is separate from `providers.disabled`, which prevents the provider from being queried at all.

#### Issues pane

Press `e` to toggle the Issues pane. It surfaces three things the quota panes don't show:

1. **Stale data** — providers whose live query failed but cached numbers are still displayed. Shows the cache age and the failure reason (e.g. `token expired`, `404`). On the quota panes, these providers get a yellow `stale 1d 15h` badge next to the provider name.
2. **Failed providers** — live errors with no cached fallback. The one-shot summary card also shows a `Stale data:` line and a `Providers: N/M reporting` line.
3. **Not configured** — providers with no credentials, listed compactly. They are silently skipped on the quota panes.

Sub-accounts that fail for the same reason are collapsed into one row (e.g. `Google (4 accounts) stale 16h`). The tab bar shows an attention badge (`e Issues 5`) when there are stale or failed providers.

#### Density

Each quota window is one row: label, meter, percent remaining, and reset countdown.

- **auto** (default) — full per-window detail when the list fits the terminal, otherwise one row per provider showing its lowest window.
- **detail** — always list every window.
- **compact** — always one row per provider.

Frames are painted differentially: only rows whose text changed are rewritten, so countdown ticks never clear or flash the screen.

#### Sample output (Current view)

Representative layout with anonymized accounts. ANSI colors render in-terminal; shown here as plain text.

```text
 usage  8 accounts  ·  5 ok  ·  1 watch  ·  2 low                    12s ago   sync 48s
 1 Current  ·  2 Weekly  ·  3 Monthly  ·  e Issues 2          2 stale  ·  detail (auto)
───────────────────────────────────────────────────────────────────────────────────────
 LongCat
   Free quota            ████░░░░░░░░░░░░░░░░░░░░░░  11%
   Total tokens          ████████████████████░░░░░░  78%
 Mistral Vibe — account-a
   Vibe Usage            ░░░░░░░░░░░░░░░░░░░░░░░░░░   0%  ↻ 9d 11h
 xAI/Grok
   Weekly SuperGrok      █████░░░░░░░░░░░░░░░░░░░░░  21%  ↻ 6d 11h
 Ollama
   Session               █████████████████████████░  95%  ↻ 2h 46m
 OpenAI
   5-hour                ██████████████████████████  99%      ↻ 5h
 Google — user
   Gemini · 5-hour       ██████████████████████████ 100%  ↻ 4h 59m
   Claude & GPT · 5-hour ██████████████████████████ 100%  ↻ 4h 59m
───────────────────────────────────────────────────────────────────────────────────────
 1/2/3 view  ·  e issues  ·  d density  ·  j/k scroll  ·  r sync  ·  q quit
```

Compact rows collapse a provider to its lowest window, with that window's name on the right:

```text
 Anthropic              ░░░░░░░░░░░░░░░░░░░░░░░░░░   0%            5-hour
 OpenAI                 ████████████████████░░░░░░  78%  ↻ 6d 19h  7-day
 Google — mattg         █████████████████████████░  95%   ↻ 4d 1h  Gemini · Weekly
```

The **Weekly** tab collects every longer window — Anthropic's general and Fable limits, OpenAI's general and named-model limits, Ollama Weekly, SuperGrok's shared weekly pool, and so on. Weekly-only providers remain visible on **Current** as their actionable quota and also appear under **Weekly** for correct horizon grouping. The **Monthly** tab shows billing-cycle windows for multi-tier plans (e.g. BytePlus Monthly). LongCat only exposes token pools (no rolling reset windows), so it stays on **Current**.

One-shot `mystatus` and `/mystatus` in OpenCode are unchanged — same card grid as before.

An alias `usage` is also installed (symlinked to `mystatus`).

### Install via the repo

```bash
git clone https://github.com/schlambos/opencode-mystatus.git
cd opencode-mystatus
./bin/mystatus --install
```

This symlinks `mystatus` and `usage` into `~/.local/bin/` (or a target of your choice).

### Requirements

- [bun](https://bun.sh) — the CLI wrapper imports the plugin source directly via `bin/mystatus-cli.ts`.
- Your credentials are read from OpenCode's standard locations (`~/.local/share/opencode/auth.json`, `~/.config/opencode/mystatus.json`, etc.) — no extra setup needed if you've already signed into providers.

## Usage

Trigger it however feels natural:

- The **`/mystatus`** or **`/usage`** slash command inside OpenCode
- **`mystatus`** from any terminal (see [standalone CLI](#standalone-cli))
- Plain language — *"check my AI quota"*, *"how much Claude do I have left?"*, *"am I about to run out of anything?"*

### Options

All options are optional and can be set per-call or as [defaults in your config](#configuration):

| Option | Values | Default | Description |
|---|---|---|---|
| `width` | number | auto | Target terminal width; cards size to fit and never wrap |
| `sort` | `urgency` · `name` · `reset` | `urgency` | Card ordering |
| `summary` | boolean | `true` | Show the summary card on top |
| `trend` | `off` · `compact` · `full` | `compact` | Trend line under each bar with color-coded sparkline (`full` adds projection) |
| `threshold` | number | `25` | Percent below which a window triggers a low-quota alert |
| `only` | comma list | — | Show only these provider ids |
| `exclude` | comma list | — | Hide these provider ids |
| `fresh` | boolean | `false` | Bypass the cache and force a live fetch |
| `format` | `ansi` · `json` | `ansi` | `json` returns machine-readable output |

Provider ids: `anthropic`, `atlascloud`, `byteplus`, `copilot`, `google`, `longcat`, `minimax`, `mistral`, `nanogpt`, `ollama`, `openai`, `opencode-go`, `poe`, `qwencloud`, `stepfun`, `xai`, `zai`.

## Configuration

Most setups need **no configuration at all**. To set persistent defaults, create `~/.config/opencode/mystatus.json` (comments are allowed). A fully documented sample lives at [`mystatus.example.json`](mystatus.example.json). Cookie-based providers have their own example files (e.g. [`longcat-cookies.example.json`](longcat-cookies.example.json)):

```jsonc
{
  // "width": 100,         // uncomment to pin a render width
  "sort": "urgency",        // urgency | name | reset
  "summary": true,          // show the summary card
  "trend": "full",          // off | compact | full
  "cacheTtlSec": 0,         // 0 = always live; cache is used only as a failure fallback
  "historyMax": 60,         // trend snapshots to retain
  "historyMinIntervalSec": 60,
  "providers": {
    "disabled": [],         // e.g. ["xai", "longcat"]
    "order": []             // preferred ordering before sort
  },
  "antigravityTools": {
    "enabled": true,        // auto-discovers ~/.antigravity_tools/gui_config.json
    "usageHours": 168,      // proxy stats period (7 days)
    "includeUsage": true    // quota still renders if false
  }
}
```

**Width resolution order:** `width` arg → `MYSTATUS_WIDTH` / `COLUMNS` env → live TTY → config `width` → safe default.

> Trends need at least two snapshots, so the very first run shows none — they appear from the second run onward.

## Provider setup

Anything authenticated inside OpenCode is detected automatically. The collapsible sections below cover the handful of providers with optional extra setup.

<details>
<summary><strong>Anthropic</strong> — zero-config</summary>

<br>

Reads its credentials straight from OpenCode's `auth.json` once you've signed into the provider. Refreshes the Claude Code OAuth token and queries `api.anthropic.com/api/oauth/usage`. The current structured `limits[]` response is rendered dynamically, including scoped model limits such as **7-day (Fable)**. The canonical `spend` object is also used for usage-credit balance, extra-usage caps, and spend percentage; the older fixed-window and `extra_usage` shapes remain supported.
</details>

<details>
<summary><strong>AtlasCloud (Coding Plan)</strong> — requires browser session token</summary>

<br>

No public usage REST API. The coding-plan API key (`apikey-…`) authenticates `api.atlascloud.ai/v1/chat/completions` only — it cannot read plan usage. The plugin reads the console's authenticated dashboard API on your behalf using a browser session cookie.

1. Log into `https://console.atlascloud.ai`.
2. Open DevTools → Application → Cookies → `console.atlascloud.ai` (or `.atlascloud.ai`).
3. Copy the full cookie header string (at minimum the `access-token=` JWT).
4. Save to `~/.config/opencode/atlas-cookies.json`:

```json
{
  "cookie": "access-token=eyJ...; g_state=...; _atlas_user_hint=..."
}
```

`accountUuid` is auto-resolved via `/api/v1/current-user`; add it explicitly only if you have multiple Atlas accounts and want to pin a specific one:

```json
{
  "cookie": "access-token=eyJ...",
  "accountUuid": "019xxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

Current monthly subscriptions expose independent **weekly** and **full-cycle** caps; pay-as-you-go packs have their own balance and expiry and can be stacked. The plugin renders every active subscription/pack instead of stopping at the first response item. Older daily-reset plans remain supported. The `access-token` JWT expires after ~7 days — the card surfaces the expiry countdown. Re-capture and overwrite when the card stops rendering. Missing file → AtlasCloud card is silently skipped.
</details>

<details>
<summary><strong>BytePlus (Ark Coding Plan)</strong> — requires browser session token</summary>

<br>

No public usage REST API. The plugin reads the dashboard's internal API on your behalf using an authenticated session. Save your `console.byteplus.com` Cookie header value to `~/.config/opencode/byteplus-cookies.json`:

```json
{ "cookie": "<full Cookie header string>" }
```

Session expires periodically — overwrite the file when the card stops rendering. Missing file → BytePlus card is silently skipped.
</details>

<details>
<summary><strong>GitHub Copilot</strong> — optional PAT for the most reliable numbers</summary>

<br>

Two auth paths are tried in order:

1. **Fine-grained PAT (recommended).** Create a token with **Plan → Read-only** at <https://github.com/settings/tokens?type=beta>, then save `~/.config/opencode/copilot-quota-token.json`:
   ```json
   { "token": "github_pat_...", "username": "YourGitHubUsername", "tier": "pro" }
   ```
   Set `tier` to `pro`, `pro+`, or `max` for an individual plan. The current monthly AI-credit allowances are 1,500, 7,000, and 20,000 respectively. Business/Enterprise credits are organization-pooled, so the user-level report shows consumed credits but deliberately does not invent a per-user remainder. Accounts still on request-based billing automatically fall back to the legacy premium-request report.
2. **OAuth fallback** from `auth.json` → `github-copilot` (with automatic token exchange).

Both public billing endpoints use GitHub's current API version. The OAuth path renders every `quota_snapshots` entry returned by Copilot, rather than a fixed three-field allowlist.
</details>

<details>
<summary><strong>Google (Antigravity)</strong> — Antigravity Tools auto-detected, auth-plugin fallback</summary>

<br>

When Antigravity Tools is installed locally, `mystatus` reads its port and management credential from `~/.antigravity_tools/gui_config.json` and prefers its read-only management API. Each enabled Google account gets its own provider card with Gemini and Claude/GPT **5-hour + weekly** quota, reset times, current/proxy-disabled state, and per-account token usage. Aggregate input/output/cache totals and top proxy models stay on the current account's card. The management credential is sent only back to the configured Antigravity Tools origin; credentials auto-read from `gui_config.json` are never sent to a non-loopback URL.

No configuration is needed for the normal local setup. For a custom port, container, or remote instance, use environment variables (recommended for secrets):

```bash
export ANTIGRAVITY_TOOLS_BASE_URL="http://127.0.0.1:8045/v1"
export ANTIGRAVITY_TOOLS_API_KEY="sk-..."
# If Antigravity Tools has a separate Web UI/admin password:
export ANTIGRAVITY_TOOLS_ADMIN_PASSWORD="..."
export ANTIGRAVITY_TOOLS_USAGE_HOURS=168
```

`/v1` or `/api` at the end of `BASE_URL` is accepted and normalized to the service root. The same values can be persisted under `antigravityTools` in `mystatus.json` as `baseUrl`, `apiKey`, `adminPassword`, `usageHours`, and `includeUsage`; environment variables take precedence. Set `antigravityTools.enabled` to `false` to force the fallback path.

If the management API is unavailable, the provider falls back automatically to [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth): accounts are read from `~/.config/opencode/antigravity-accounts.json`, queried live through Google, and served from cached quota when the live call fails. This fallback also renders one card per enabled account.
</details>

<details>
<summary><strong>MiniMax (Token Plan)</strong> — zero-config</summary>

<br>

Reads its credentials straight from OpenCode's `auth.json` once you've signed into the provider. Reads `minimax-coding-plan` (key must start with `sk-cp-`); shows the current unified 5-hour and weekly Token Plan pools. Older responses with named capability buckets remain compatible, and reset durations are normalized without confusing weekly seconds for milliseconds.
</details>

<details>
<summary><strong>Mistral</strong> — requires browser session token</summary>

<br>

Mistral's inference key does not expose the Vibe plan budget. Save the signed-in `console.mistral.ai` Cookie header (including `csrftoken`) to `~/.config/opencode/mistral-cookies.json`:

```json
{ "alias": "primary", "cookie": "csrftoken=...; ..." }
```

For multiple organizations/accounts, use `{ "accounts": [ { "alias": "...", "cookie": "..." } ] }`. Each account's console-reported percentage and reset is labeled as its **Monthly Vibe budget**.
</details>

<details>
<summary><strong>NanoGPT</strong> — zero-config</summary>

<br>

Reads native `auth.json` `nano-gpt` keys and `opencode-nanogpt-multi-auth`'s `~/.local/share/opencode/nanogpt-keys.json` pool. It always shows USD/XNO balance and dynamically supports both subscription contracts: documented daily/monthly operation allowances and the newer weekly-input-token/daily-image limits. Missing `remaining` values are derived from `limit - used` rather than treated as zero.
</details>

<details>
<summary><strong>OpenAI</strong> — zero-config</summary>

<br>

Reads its credentials straight from OpenCode's `auth.json` once you've signed into the provider. Calls `chatgpt.com/backend-api/wham/usage`; reports plan, credits, and all returned quota buckets. The general Codex limit, `code_review_rate_limit`, and every backend-named `additional_rate_limits` entry (for example **GPT-5.3-Codex-Spark**) get independent windows, reset timers, trends, and alerts. Available/applicable reset credits, approximate local/cloud message ranges, and spend-control state are included when present.
</details>

<details>
<summary><strong>Ollama Cloud</strong> — requires browser session token</summary>

<br>

Ollama's inference API key (`auth.json` → `ollama-cloud`) can run models but **cannot** read account quota. Save your signed-in browser session to `~/.config/opencode/ollama-cookies.json`:

```json
{
  "cookie": "__Secure-session=...; aid=..."
}
```

Copy the `Cookie` header from DevTools → Network on any `ollama.com` request after signing in. The plugin scrapes `ollama.com/settings` for session/weekly GPU-time windows and enriches with the renewal date from `/settings/billing`.

`__Secure-session` expires periodically — overwrite when the card stops rendering. Missing file → Ollama card is silently skipped.
</details>

<details>
<summary><strong>LongCat API</strong> — requires browser session token</summary>

<br>

LongCat's inference API key (`ak_…` in `opencode.json` → `provider.longcat`) can call `api.longcat.chat` but **cannot** read account quota. Quota is served only by the signed-in platform portal at `longcat.chat`.

**Required browser cookies**

| Cookie | Config field | Notes |
|---|---|---|
| `passport_token_key` | `passportToken` | Meituan/Friday passport session — **required** |
| `long_cat_region_key` | `region` | Region selector — **required** (usually `"2"`) |

**Setup**

1. Log into [longcat.chat/platform/usage](https://longcat.chat/platform/usage).
2. Open DevTools → **Network** → reload → pick any `longcat.chat/api/…` request.
3. Copy the `Cookie` header **or** extract `passport_token_key` and `long_cat_region_key` from Application → Cookies.
4. Save to `~/.config/opencode/longcat-cookies.json` (see [`longcat-cookies.example.json`](longcat-cookies.example.json)):

```json
{
  "passportToken": "<passport_token_key cookie value>",
  "region": "2"
}
```

Full cookie string also works (both required cookies must be present):

```json
{
  "cookie": "passport_token_key=...; long_cat_region_key=2; ..."
}
```

**What the card shows**

- **Free quota** — `freeAvailableToken / freeRefreshToken`. This is what depletes first and triggers `Token 额度不足` on the inference API when empty.
- **Total tokens** — `availableToken / totalToken` across free tier + unredeemed fuel packages.
- **Fuel packages** — count, combined remaining tokens, nearest expiry.
- **Header** — account email (from `/api/v1/user-current`), active API key count.

`passport_token_key` expires periodically — re-capture and overwrite when the card stops rendering. Missing file → LongCat card is silently skipped.
</details>

<details>
<summary><strong>OpenCode Go+Zen</strong> — add a workspace cookie for full quota + spend</summary>

<br>

With just an API key (`auth.json` → `opencode-go`) the plugin only confirms reachability. Quota windows + Zen balance/spend live behind authenticated workspace dashboard SSR, so the plugin needs a session. Save to `~/.config/opencode/opencode-go.json`:

```json
{
  "accounts": [
    {
      "id": "personal",
      "name": "OpenCode Go Personal",
      "workspaceId": "<workspace uuid>",
      "authCookie": "<opencode.ai auth cookie value>"
    }
  ]
}
```

Single-account shorthand `{ "workspaceId": "...", "authCookie": "..." }` or the `OPENCODE_GO_WORKSPACE_ID` / `OPENCODE_GO_AUTH_COOKIE` env vars also work.

- **Workspace ID** — UUID segment in your dashboard URL (`opencode.ai/workspace/<uuid>/go`).
- **Auth cookie** — the `auth` cookie on `opencode.ai`. Expires with your browser session — overwrite when the card stops rendering.
</details>

<details>
<summary><strong>Poe</strong> — auto-detected, or bring your own key</summary>

<br>

Resolved in priority order: `auth.json` → `poe` (populated when you use a Poe model in OpenCode), then `POE_API_KEY`, then `~/.config/opencode/poe-api-key.json` (`{ "apiKey": "..." }`). Get a key at <https://poe.com/api_key>.

Poe's documented endpoint guarantees the **total current point balance**. Some accounts also return plan-only points, add-on points, and grant metadata. `mystatus` only calculates a monthly percentage when both the monthly grant and plan-only balance are present, so add-on points cannot inflate the subscription remainder. Epoch-second, millisecond, and microsecond grant times are all accepted.
</details>

<details>
<summary><strong>QwenCloud</strong> — requires browser session token</summary>

<br>

No public usage REST API. The plugin queries the Aliyun BSS console API on your behalf using an authenticated session. Save your `home.qwencloud.com` cookie values to `~/.config/opencode/qwencloud-cookies.json`:

```json
{
  "ticket": "<login_qwencloud_ticket>",
  "aliyunPk": "<login_aliyunid_pk>",
  "isg": "<isg>",
  "esmTicket": "<login_ESM_account_ticket>"
}
```

`esmTicket` is optional. Session expires periodically — overwrite the file when the card stops rendering. Missing file → QwenCloud card is silently skipped.
</details>

<details>
<summary><strong>StepFun</strong> — requires browser session token</summary>

<br>

No public usage REST API. The plugin hits the dashboard's internal tRPC API on your behalf using an authenticated session. Save your `platform.stepfun.ai` cookie values to `~/.config/opencode/stepfun-cookies.json`:

```json
{
  "oasisToken": "<Oasis-Token>",
  "oasisWebid": "<Oasis-Webid>",
  "sessionToken": "<__Secure-next-auth.session-token>"
}
```

Session expires periodically — overwrite the file when the card stops rendering. Missing file → StepFun card is silently skipped.

The current public Step Plan advertises a 5-hour prompt pool. The dashboard response is treated as authoritative: the weekly window is shown only if its fields are actually returned, rather than rendering an empty/`NaN` quota.
</details>

<details>
<summary><strong>xAI / Grok</strong> — zero-config (+ optional `grok login`)</summary>

<br>

Reads OpenCode's `auth.json` (`xai-oauth` / `xai` — opencode dev-referrer OAuth token) for the dev-API liveness check and as a billing fallback. If you've also run `grok login`, it picks up the consumer (grok-build) token at `~/.grok/auth.json` and prefers it for billing (auto-refreshes via `refresh_token`).

Usage comes from `cli-chat-proxy.grok.com/v1/billing`. SuperGrok now provides one shared **weekly** included-usage pool across API, Build, Chat, Imagine, and Voice, followed by optional extra-usage credits. The `?format=credits` view supplies the authoritative weekly percentage, per-product breakdown, and reset shown by Grok Build's `/usage` command. The default view is a separate monthly dollar ledger; when present, the card labels it as a reference instead of treating it as part of the weekly allowance. The live TUI places the actual limit on the Weekly pane.
</details>

<details>
<summary><strong>Z.AI (GLM Coding Plan)</strong> — zero-config</summary>

<br>

Reads its credentials straight from OpenCode's `auth.json` once you've signed into the provider. Reads `zai-coding-plan`; shows the 5-hour and weekly prompt pools plus monthly MCP/tool-call limits. Limit `type` and usage-detail metadata are used to keep multiple monthly pools distinct instead of presenting several anonymous “Monthly” rows.
</details>

## Security &amp; privacy

`mystatus` is **read-only** for your accounts and contacts each provider's own API only.

- Credentials are read locally and sent **only** to their respective provider.
- The only files it *writes* are local, non-sensitive helpers in `~/.config/opencode/`: a small cache (`mystatus-cache.json`) and trend history (`mystatus-history.json`).
- Nothing is logged or transmitted anywhere else. The full source is open for review.

<details>
<summary>Files read &amp; endpoints contacted</summary>

<br>

**Read (never modified):** `~/.local/share/opencode/auth.json`, optional `~/.grok/auth.json` (consumer Grok token written by `grok login`), optional `~/.antigravity_tools/gui_config.json`, and the optional `antigravity-accounts.json`, `opencode-go.json`, `copilot-quota-token.json`, `poe-api-key.json`, `stepfun-cookies.json`, `qwencloud-cookies.json`, `byteplus-cookies.json`, `atlas-cookies.json`, `mistral-cookies.json`, `ollama-cookies.json`, `longcat-cookies.json` under `~/.config/opencode/`.

| Provider | Endpoint(s) |
|---|---|
| Anthropic | `api.anthropic.com/api/oauth/usage`, `console.anthropic.com/v1/oauth/token` |
| AtlasCloud | `console.atlascloud.ai/api/v1/current-user`, `.../codeplan/get`, `.../codeplan/costs` |
| BytePlus | `console.byteplus.com/api/...` |
| GitHub Copilot | `api.github.com/copilot_internal/*`, `api.github.com/users/*/settings/billing/...` |
| Google / Antigravity Tools | Local/configured Antigravity Tools `/health`, `/api/accounts`, `/api/stats/token/{summary,by-account,by-model}`; fallback: `cloudcode-pa.googleapis.com/...:{loadCodeAssist,retrieveUserQuota}`, `oauth2.googleapis.com/token` |
| MiniMax | `api.minimax.io/v1/token_plan/remains` |
| Mistral | `vibe.mistral.ai/api/...` |
| NanoGPT | `nano-gpt.com/api/check-balance`, `nano-gpt.com/api/subscription/v1/usage` |
| OpenAI | `chatgpt.com/backend-api/wham/usage` |
| Ollama | `ollama.com/settings`, `ollama.com/settings/billing` |
| LongCat | `longcat.chat/api/lc-platform/v1/tokenUsage`, `longcat.chat/api/v1/user-current`, `longcat.chat/api/lc-platform/v1/query-active-apiKeys` |
| OpenCode Go+Zen | `opencode.ai/zen/go/v1/models`, `opencode.ai/workspace/*/{go,billing,usage}` |
| Poe | `api.poe.com/usage/current_balance` |
| QwenCloud | `home.qwencloud.com/data/api.json?...GetSeatSubscriptionSummary` |
| StepFun | `platform.stepfun.ai/api/.../Dashboard/QueryStepPlanRateLimit`, `.../GetStepPlanStatus` |
| xAI / Grok | `cli-chat-proxy.grok.com/v1/billing`, `api.x.ai/v1/models` |
| Z.AI | `api.z.ai/api/biz/subscription/list`, `api.z.ai/api/monitor/usage/quota/limit` |

Some usage endpoints are internal/undocumented and may change without notice; the plugin degrades gracefully when one is unavailable.
</details>

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit (strict)
npm run build       # tsc → dist/
```

The plugin is a single self-contained module at `plugin/mystatus.ts`. Providers are registered in one array — each is an independent `query*` function that returns a structured `ProviderCard`, so adding a new one is a small, contained change.

The standalone CLI lives at `bin/mystatus-cli.ts` — a thin wrapper that imports `MyStatusPlugin` and calls `execute()` directly, bypassing OpenCode. The `bin/mystatus` bash script finds its way via `dirname $0` so it works from any location after `--install`.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Credits

Originally a fork of [vbgate/opencode-mystatus](https://github.com/vbgate/opencode-mystatus), since rebuilt and extended well beyond the original: a structured quota model, responsive single-column cards, a summary view, urgency sorting, usage trends with projections, caching/retry resilience, and support for Anthropic, AtlasCloud (Coding Plan), BytePlus (Ark Coding Plan), GitHub Copilot, LongCat API, MiniMax, Mistral (Vibe Usage), NanoGPT, Ollama Cloud, OpenCode Go+Zen, Poe, multi-account Google, QwenCloud, StepFun, xAI/Grok, and Z.AI.

## License

[MIT](LICENSE)

## Desktop app

A native desktop companion — `mystatus-desktop` — lives in `desktop/`. It is an Electron + electron-vite + React + TypeScript + Tailwind app that imports the plugin core (`plugin/mystatus.ts`) in-process, so the terminal plugin and the desktop app share one source of truth for provider logic. The desktop app is purely additive: it does not modify `plugin/`, `bin/`, `command/`, or `dist/`, and the one-shot `/mystatus` command, the standalone CLI, and the `--watch` TUI keep working unchanged.

### Install & build

```bash
npm --prefix desktop install          # install desktop deps (Electron, electron-vite, React, Tailwind, vitest, playwright)
npm --prefix desktop run dev          # electron-vite dev — launches the app window with HMR
npm --prefix desktop run build        # electron-vite build — emits out/{main,preload,renderer}
npx electron-builder --dir            # from desktop/ — produces an unpacked app in desktop/release/ (no installer)
```

`npm --prefix desktop run typecheck` runs `tsc --noEmit` against the desktop tsconfig; the repo-root `npm run typecheck` must also stay green.

### Features

- **Dashboard** — three horizon tabs (**Current** / **Weekly** / **Monthly**) using the TUI's exact window-tier classification, a summary header (account tally, green/yellow/red counts, lowest window, soonest reset, reporting/failed/not-configured health line), per-window remaining-% meters, trend sparklines (off / compact / full), live reset countdowns ticking every second, hide/show providers persisted to `providers.hidden`, and an Issues panel (error / stale / unconfigured, with sub-account collapse).
- **In-app Chromium sign-in** for the eight cookie providers — AtlasCloud, BytePlus, LongCat, Mistral, Ollama, QwenCloud, StepFun, OpenCode Go+Zen — each opens the provider's own login page in an isolated in-memory session, detects the sentinel cookie, and writes the exact JSON schema the plugin already reads to `~/.config/opencode/`. See the [cookie-provider table](#providers-that-need-a-browser-session-token) for the file each provider expects.
- **Guided paste** for the GitHub Copilot PAT (`copilot-quota-token.json`) and the Poe API key (`poe-api-key.json`), with deep-links to the token-creation pages and per-field validation.
- **Settings** over every `mystatus.json` knob (sort, summary, trend, `cacheTtlSec`, `historyMax`, `historyMinIntervalSec`, `watchIntervalSec`, `uiRefreshSec`, `providers.disabled`/`hidden`/`order`, `google.excludeEmails`, `antigravityTools.*`) via atomic read-modify-write with verify-after-write.
- **Export** — copy or save the current snapshot as JSON (`format: json`) or ANSI card text.
- **Tray** with a status-colored icon (green/yellow/red by worst window), a context menu (Show Dashboard / Refresh Now / Issues / Quit), and keep-running-on-window-close.
- **Low-quota notifications** — native OS notification on the **edge transition** of a window crossing below threshold, with a per-`(provider, window)` cooldown (default 60 min) so a provider sitting below threshold across many polls produces one notification, not many.
- **Launch at login** toggle (macOS / Windows; Linux persists the preference as a no-op).

### Desktop-only preferences

Desktop-only preferences live in `~/.config/opencode/mystatus-desktop.json` — **not** in `mystatus.json`. They are:

| Key | Type | Notes |
|---|---|---|
| `threshold` | number | Percent below which a window is "low" — the core reads `threshold` only from per-call args, so it cannot live in `mystatus.json` |
| `notifications` | boolean | Master switch for low-quota notifications |
| `notifyCooldownMin` | number | Per-`(provider, window)` notification cooldown in minutes |
| `trendMode` | `off` \| `compact` \| `full` | UI display override when the user has not saved a default in `mystatus.json` |
| `lastTab` | `current` \| `weekly` \| `monthly` \| `issues` \| `hidden` | Restored on next launch |
| `windowBounds` | `{ x, y, width, height }` | Restored on next launch |
| `launchAtLogin` | boolean | Mirrors `app.setLoginItemSettings` |

The file is written atomically (tmp + rename, mode `0o600`) and never holds credentials or provider data.

### Unsigned builds

The first builds are **unsigned**.

- **macOS** — Gatekeeper blocks the app on first launch. Right-click the app in Finder → **Open** → confirm the prompt. This is required once per download.
- **Windows** — SmartScreen shows a "Windows protected your PC" warning; click **More info** → **Run anyway**.
- **Auto-update is disabled** on unsigned builds. `electron-updater` is wired but gated behind `app.isPackaged && updatesEnabled`; to opt into updates on a self-built, signed package set `MYSTATUS_ENABLE_UPDATES=1` in the environment **and** ship a packaged (not `--dir`) build. Signing config (`CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_API_KEY` / `APPLE_API_ISSUER` for macOS notarytool, Windows `signtool` / Azure Trusted Signing) is documented as a placeholder only — no signing identity is fabricated.

### Drift note — tier classification

`desktop/src/renderer/lib/tiers.ts` is a **vendored re-implementation** of the private tier-classification logic in `plugin/tui.ts:304-402` (`windowTier`, `splitTiers`, `windowsForView`, `groupsForView`). Those functions are module-private in the TUI and cannot be imported, and this plan forbids editing the core. Parity is locked by a golden fixture table hand-derived by reading `plugin/tui.ts:304-402` line by line. **If the TUI changes its tier classification, re-verify `tiers.ts` against the new lines.**

### Concurrent writers

The plugin, the CLI, the TUI, and the desktop app all write three shared files in `~/.config/opencode/`:

- `mystatus.json` — config (sort, summary, trend, intervals, `providers.*`, `antigravityTools.*`, `google.excludeEmails`)
- `mystatus-cache.json` — provider cache fallback
- `mystatus-history.json` — trend snapshots

The desktop app uses **atomic write + verify-after-write** (tmp + rename, then re-read and deep-compare) for every save path, and re-reads the config before each save so an external edit by OpenCode, the CLI, or the TUI is not silently clobbered. The core's own `saveConfig` is used only for single-key dashboard mutations and is always followed by a verify re-read.
