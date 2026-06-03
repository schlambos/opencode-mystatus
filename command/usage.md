---
description: Query quota usage for all AI accounts
---

Use the mystatus tool to query quota usage. Output is a single-column stack of provider cards — if you know the user's terminal width, pass it as the `width` argument so the cards size to the terminal and never wrap (otherwise it falls back to MYSTATUS_WIDTH/COLUMNS env, ~/.config/opencode/mystatus.json, then a safe default). Wrap the entire returned output in a single fenced ```text code block so the Unicode box-drawing borders, cell alignment, and line widths are preserved exactly (do not reformat, reflow, wrap, or 'fix' the table — the pre-aligned layout is correct as-is).
