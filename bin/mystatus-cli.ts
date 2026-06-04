import { MyStatusPlugin } from "../plugin/mystatus.ts";

function parseArgs(argv: string[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const argKeys: Record<string, string> = {
    "--format": "format",
    "--threshold": "threshold",
    "--width": "width",
    "--sort": "sort",
    "--trend": "trend",
    "--only": "only",
    "--exclude": "exclude",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help") { args["--help"] = true; continue; }
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
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
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
  --sort <urgency|name|reset>
                           Sort order for provider cards (default: urgency)
  --summary <bool>         Show summary card (default: true)
  --no-summary             Hide summary card
  --trend <off|compact|full>
                           Trend display mode (default: compact)
  --only <ids>             Only show these providers (comma-separated)
  --exclude <ids>          Exclude these providers (comma-separated)
  --fresh                  Bypass cache, force fresh queries
  --help                   Show this help message

Providers: openai,anthropic,google,copilot,opencode-go,poe,zai,xai,minimax,nanogpt`);
}

const cliArgs = parseArgs(process.argv.slice(2));

if (cliArgs["--help"]) {
  showHelp();
  process.exit(0);
}
delete cliArgs["--help"];

const plugin = await MyStatusPlugin({} as any);
const toolResult = await plugin.tool!["mystatus"].execute(cliArgs, {} as any);
const output = typeof toolResult === "string" ? toolResult : toolResult.output;
console.log(output);
