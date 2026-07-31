#!/usr/bin/env bun
/**
 * Standalone mystatus CLI — invoked by bin/mystatus (bash wrapper).
 * Do not copy this file to ~/.local/bin; the wrapper resolves the repo path.
 */
import { MyStatusPlugin } from "../plugin/mystatus.ts";
import { runMyStatusTui } from "../plugin/tui.ts";

function parseArgs(argv: string[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const argKeys: Record<string, string> = {
    "--format": "format",
    "--threshold": "threshold",
    "--width": "width",
    "--layout": "layout",
    "--sort": "sort",
    "--trend": "trend",
    "--only": "only",
    "--exclude": "exclude",
    "--interval": "interval",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { args["--help"] = true; continue; }
    if (arg === "--watch" || arg === "-w") { args["watch"] = true; continue; }
    if (arg === "--fresh") { args["fresh"] = true; continue; }
    if (arg === "--summary") { args["summary"] = true; continue; }
    if (arg === "--no-summary") { args["summary"] = false; continue; }
    const eqIdx = arg.indexOf("=");
    if (eqIdx !== -1) {
      const key = argKeys[arg.slice(0, eqIdx)] ?? arg.slice(2, eqIdx);
      const val: string = arg.slice(eqIdx + 1);
      const num = Number(val);
      args[key] = Number.isFinite(num) && val !== "" && !isNaN(num) ? num : val;
    } else {
      const key = argKeys[arg] ?? arg.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        const val: string = argv[++i];
        const num = Number(val);
        args[key] = Number.isFinite(num) && val !== "" && !isNaN(num) ? num : val;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function showHelp(): void {
  console.log(`Usage: mystatus [options]

Query AI platform quota usage. Displays a card-based overview of
remaining quota, usage stats, and reset countdowns for all configured
AI providers.

Options:
  --format <ansi|json>     Output format (default: ansi)
  --threshold <number>     Alert threshold percentage (default: 25)
  --width <number>         Terminal column width for card sizing
  --layout <auto|single|double>
                           Card layout (default: auto — two columns when wide enough)
  --sort <urgency|name|reset>
                           Sort order for provider cards (default: urgency)
  --summary <bool>         Show summary card (default: true)
  --no-summary             Hide summary card
  --trend <off|compact|full>
                           Trend display mode (default: compact)
  --only <ids>             Only show these providers (comma-separated)
  --exclude <ids>          Exclude these providers (comma-separated)
  --fresh                  Bypass cache, force fresh queries
  -w, --watch              Live TUI dashboard (requires a TTY)
  --interval <seconds>     Provider refresh interval in watch mode (default: 60)
  -h, --help               Show this help message

Watch mode keys: 1/2/3 or Tab views, e issues, x hide/show provider,
                 d density (auto/detail/compact), j/k or arrows scroll,
                 space/b page, g/G top/bottom, r refresh, q quit

Providers: anthropic,atlascloud,byteplus,copilot,google,longcat,minimax,mistral,
           nanogpt,ollama,openai,opencode-go,poe,qwencloud,stepfun,xai,zai`);
}

const rawArgv = process.argv.slice(2).filter((a) => a !== "--");
const cliArgs = parseArgs(rawArgv);

if (cliArgs["--help"]) {
  showHelp();
  process.exit(0);
}
delete cliArgs["--help"];

const watch = cliArgs["watch"] === true || rawArgv.includes("--watch") || rawArgv.includes("-w");
const interval = typeof cliArgs["interval"] === "number" ? cliArgs["interval"] : undefined;
delete cliArgs["watch"];
delete cliArgs["interval"];

if (watch) {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error("mystatus --watch requires an interactive terminal (TTY).");
    process.exit(1);
  }
  try {
    await runMyStatusTui({
      args: cliArgs,
      intervalSec: interval,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  process.exit(0);
}

const plugin = await MyStatusPlugin({} as any);
const toolResult = await plugin.tool!["mystatus"].execute(cliArgs, {} as any);
const output = typeof toolResult === "string" ? toolResult : toolResult.output;
console.log(output);
