---
description: Query quota usage for all AI accounts
---

Use the mystatus tool to query quota usage. The output is a pre-rendered, problems-first report (summary, cards for constrained providers, an "All clear" list). If you know the user's terminal width, pass it as the `width` argument so the layout sizes to the terminal and never wraps (otherwise it falls back to MYSTATUS_WIDTH/COLUMNS env, ~/.config/opencode/mystatus.json, then a safe default). Wrap the entire returned output in a single fenced ```text code block so the Unicode box-drawing borders, column alignment, and line widths are preserved exactly (do not reformat, reflow, wrap, or 'fix' it — the pre-aligned layout is correct as-is).
