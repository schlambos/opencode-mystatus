#!/usr/bin/env node
// Headless smoke gate for mystatus-desktop.
//
// Runs, in order, exiting non-zero on the first failure:
//   1. repo-root typecheck   (npm --prefix .. run typecheck)
//   2. desktop typecheck     (npm run typecheck)
//   3. desktop tests         (npm test — vitest run)
//   4. desktop build         (npm run build — electron-vite build)
//   5. leak scan             (grep desktop/out + desktop/src for real-looking secrets)
//
// HARD CONSTRAINT: this script MUST NOT launch Electron, Playwright, electron-vite dev,
// or the packaged app. It only runs typecheck / test / build / a static grep.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const desktopDir = resolve(__dirname, "..");
const repoRoot = resolve(desktopDir, "..");

const FAIL = "\u001b[31mFAIL\u001b[0m";
const PASS = "\u001b[32mPASS\u001b[0m";
const STEP = "\u001b[36mSTEP\u001b[0m";

function run(cmd, args, opts = {}) {
  const label = `${cmd} ${args.join(" ")}`;
  console.log(`\n${STEP} ${label}`);
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: opts.cwd ?? desktopDir,
    env: { ...process.env, CI: "1" },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`${FAIL} ${label} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
  console.log(`${PASS} ${label}`);
}

// --- Gates 1-4 ---------------------------------------------------------------

run("npm", ["--prefix", "..", "run", "typecheck"], { cwd: desktopDir }); // repo root
run("npm", ["run", "typecheck"], { cwd: desktopDir }); // desktop
run("npm", ["test"], { cwd: desktopDir }); // vitest run
run("npm", ["run", "build"], { cwd: desktopDir }); // electron-vite build

// --- Gate 5: leak scan -------------------------------------------------------
//
// We look for REAL-looking secret VALUES, not cookie NAMES or schema identifiers.
// A "real-looking" value is:
//   - A cookie-name `=` assignment with a long (20+ char) literal value that is NOT
//     a template interpolation (`${...}`) and NOT inside a regex literal.
//   - A known secret PREFIX (`ghp_`, `github_pat_`, `sk-`) followed by 36+ base64-ish
//     characters (real PATs are 40+, real OpenAI keys are 48+; test fakes are shorter).
//
// We deliberately SKIP:
//   - `.test.ts` / `.test.tsx` files (they contain fixtures by design).
//   - Lines containing `${` after the `=` (template literal interpolation, not a literal).
//   - Lines that are regex literals: contain `/.test(`, `/.match(`, `/.exec(`, `RegExp(`.
//   - Bare cookie NAMES without a value (schema/spec identifiers).

const MIN_COOKIE_VALUE_LEN = 20;
const MIN_PREFIX_LEN = 36; // ghp_ = 36+ (real = 40), github_pat_ = 36+, sk- = 36+ (real = 48)

const COOKIE_VALUE_PATTERNS = [
  /passport_token_key\s*=\s*([^\s"';,}]+)/,
  /__Secure-session\s*=\s*([^\s"';,}]+)/,
  /access-token\s*=\s*([^\s"';,}]+)/,
];

const PREFIX_PATTERNS = [
  /ghp_([A-Za-z0-9]{36,})/,
  /github_pat_([A-Za-z0-9_]{36,})/,
  /sk-([A-Za-z0-9]{36,})/,
];

function isRegexLine(line) {
  return /\/[^/]*=\s*\/\s*\.test\(|\/[^/]*=\s*\/\s*\.match\(|\/[^/]*=\s*\/\s*\.exec\(|new RegExp\(|RegExp\(/.test(
    line,
  );
}

function isTemplateLine(line) {
  // Template literal interpolation after an `=`: `name=${...}`
  return /=\s*\$\{/.test(line);
}

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("#") || t.startsWith("/*") || t.startsWith("*");
}

function isTestFile(filePath) {
  return /\.test\.tsx?$/.test(filePath);
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "release") continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (st.isFile()) {
      yield full;
    }
  }
}

function scanFile(filePath) {
  if (isTestFile(filePath)) return [];
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const lines = content.split(/\r?\n/);
  const hits = [];
  lines.forEach((line, i) => {
    if (isRegexLine(line) || isTemplateLine(line) || isCommentLine(line)) return;

    // Cookie-name = <value> patterns
    for (const re of COOKIE_VALUE_PATTERNS) {
      const m = line.match(re);
      if (m) {
        const value = m[1];
        // Skip if value is too short (test fake) or is a template/regex artifact.
        if (value.length >= MIN_COOKIE_VALUE_LEN && !value.includes("${")) {
          hits.push({ file: filePath, line: i + 1, text: line.trim().slice(0, 200) });
          return;
        }
      }
    }

    // Prefix patterns (ghp_, github_pat_, sk-)
    for (const re of PREFIX_PATTERNS) {
      const m = line.match(re);
      if (m) {
        hits.push({ file: filePath, line: i + 1, text: line.trim().slice(0, 200) });
        return;
      }
    }
  });
  return hits;
}

console.log(`\n${STEP} leak scan: desktop/out + desktop/src`);
const scanRoots = [join(desktopDir, "out"), join(desktopDir, "src")];
const allHits = [];
for (const root of scanRoots) {
  for (const file of walk(root)) {
    allHits.push(...scanFile(file));
  }
}

if (allHits.length > 0) {
  console.error(`\n${FAIL} leak scan: ${allHits.length} hit(s)`);
  for (const h of allHits) {
    console.error(`  ${h.file}:${h.line}: ${h.text}`);
  }
  process.exit(1);
}
console.log(`${PASS} leak scan: no real-looking secrets in desktop/out or desktop/src`);

console.log("\n\u001b[32mAll smoke gates passed.\u001b[0m");