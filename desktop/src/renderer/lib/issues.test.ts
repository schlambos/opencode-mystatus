import { describe, expect, it } from "vitest";
import type { StatusIssue } from "../../shared/ipc";
import {
  commonPrefix,
  compactNames,
  dedupePrefix,
  groupAttentionIssues,
  isCookieProvider,
  shortProvider,
  unconfiguredNames,
} from "./issues";

// Parity anchors: plugin/tui.ts:205-248 (name helpers), 512-536 (groupIssueRows),
// 538-563 (buildIssueBody); plugin/mystatus.ts:7228-7257 (issue ordering).

const HOUR = 3_600_000;

describe("shortProvider — strips core title boilerplate", () => {
  it("removes the documented suffixes", () => {
    expect(shortProvider("Anthropic Account Quota")).toBe("Anthropic");
    expect(shortProvider("Z.AI Coding Plan")).toBe("Z.AI");
    expect(shortProvider("MiniMax Token Plan")).toBe("MiniMax");
    expect(shortProvider("Ollama Cloud")).toBe("Ollama");
    expect(shortProvider("Mistral Vibe Usage")).toBe("Mistral Vibe");
    expect(shortProvider("LongCat API Quota")).toBe("LongCat API");
  });

  it("collapses `Name — Name` when the first part already contains the second", () => {
    expect(shortProvider("Google — Google")).toBe("Google");
  });

  it("keeps `Name — email` intact", () => {
    expect(shortProvider("Google — jane@gmail.com")).toBe("Google — jane@gmail.com");
  });
});

describe("compactNames — email local-parts, only while unambiguous", () => {
  it("shortens unique emails to their local part", () => {
    expect(compactNames(["Google — jane@gmail.com"])).toEqual(["Google — jane"]);
  });

  it("keeps the full name when two local parts would collide", () => {
    const input = ["Google — jane@gmail.com", "Google — jane@work.com"];
    expect(compactNames(input)).toEqual(input);
  });
});

describe("commonPrefix", () => {
  it("trims trailing separators and punctuation", () => {
    expect(commonPrefix(["Google — a", "Google — b", "Google — c"])).toBe("Google");
  });

  it("returns empty for no common prefix", () => {
    expect(commonPrefix(["OpenAI", "Anthropic"])).toBe("");
  });

  it("handles empty input", () => {
    expect(commonPrefix([])).toBe("");
  });
});

describe("dedupePrefix — strips a self-wrapped `X: X` prefix, keeps the tail", () => {
  it("removes the redundant wrapper around a nested error", () => {
    expect(dedupePrefix("LongCat: LongCat failed")).toBe("LongCat failed");
    expect(dedupePrefix("Mistral: Mistral rate limited")).toBe("Mistral rate limited");
  });

  it("leaves non-wrapped detail untouched", () => {
    expect(dedupePrefix("token expired")).toBe("token expired");
  });
});

describe("groupAttentionIssues — sub-account collapse (PARITY tui.ts:512-536)", () => {
  it("collapses four same-reason stale sub-accounts into one row", () => {
    const issues: StatusIssue[] = [
      { provider: "Google — a@gmail.com", kind: "stale", detail: "token expired", ageMs: 16 * HOUR },
      { provider: "Google — b@gmail.com", kind: "stale", detail: "token expired", ageMs: 16 * HOUR },
      { provider: "Google — c@gmail.com", kind: "stale", detail: "token expired", ageMs: 16 * HOUR },
      { provider: "Google — d@gmail.com", kind: "stale", detail: "token expired", ageMs: 16 * HOUR },
    ];
    const groups = groupAttentionIssues(issues);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g?.provider).toBe("Google (4 accounts)");
    expect(g?.status).toBe("stale 16h");
    expect(g?.kind).toBe("stale");
    expect(g?.providers).toHaveLength(4);
  });

  it("does NOT collapse stale issues with different reasons", () => {
    const issues: StatusIssue[] = [
      { provider: "Google — a@gmail.com", kind: "stale", detail: "token expired", ageMs: 16 * HOUR },
      { provider: "Google — b@gmail.com", kind: "stale", detail: "404 not found", ageMs: 16 * HOUR },
    ];
    expect(groupAttentionIssues(issues)).toHaveLength(2);
  });

  it("does NOT collapse stale issues far apart in age (>1 minute bucket)", () => {
    const issues: StatusIssue[] = [
      { provider: "Google — a@gmail.com", kind: "stale", detail: "token expired", ageMs: 1 * HOUR },
      { provider: "Google — b@gmail.com", kind: "stale", detail: "token expired", ageMs: 5 * HOUR },
    ];
    expect(groupAttentionIssues(issues)).toHaveLength(2);
  });

  it("labels a single error provider as `failed` with no `(N accounts)`", () => {
    const issues: StatusIssue[] = [{ provider: "xAI/Grok", kind: "error", detail: "401 unauthorized" }];
    const groups = groupAttentionIssues(issues);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.provider).toBe("xAI/Grok");
    expect(groups[0]?.status).toBe("failed");
    expect(groups[0]?.kind).toBe("error");
  });

  it("keeps error groups ahead of stale groups (core ordering)", () => {
    const issues: StatusIssue[] = [
      { provider: "xAI/Grok", kind: "error", detail: "boom" },
      { provider: "Ollama Cloud", kind: "stale", detail: "timeout", ageMs: 2 * HOUR },
    ];
    const kinds = groupAttentionIssues(issues).map((g) => g.kind);
    expect(kinds).toEqual(["error", "stale"]);
  });

  it("excludes unconfigured issues entirely", () => {
    const issues: StatusIssue[] = [
      { provider: "Poe Account Quota", kind: "unconfigured", detail: "no credentials found" },
      { provider: "xAI/Grok", kind: "error", detail: "boom" },
    ];
    const groups = groupAttentionIssues(issues);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("error");
  });
});

describe("unconfiguredNames — compact comma list (PARITY tui.ts:554-560)", () => {
  it("joins compacted names of not-configured providers", () => {
    const issues: StatusIssue[] = [
      { provider: "Poe Account Quota", kind: "unconfigured", detail: "no credentials found" },
      { provider: "LongCat API Quota", kind: "unconfigured", detail: "no credentials found" },
      { provider: "xAI/Grok", kind: "error", detail: "boom" },
    ];
    expect(unconfiguredNames(issues)).toBe("Poe, LongCat API");
  });

  it("returns an empty string when nothing is unconfigured", () => {
    expect(unconfiguredNames([{ provider: "xAI/Grok", kind: "error", detail: "x" }])).toBe("");
  });
});

describe("isCookieProvider — Credentials-page link routing", () => {
  it("matches the eight browser-session providers despite title suffixes", () => {
    expect(isCookieProvider("AtlasCloud Coding Plan")).toBe(true);
    expect(isCookieProvider("LongCat API Quota")).toBe(true);
    expect(isCookieProvider("Ollama Cloud")).toBe(true);
    expect(isCookieProvider("OpenCode Go+Zen Account Quota")).toBe(true);
    expect(isCookieProvider("QwenCloud Token Plan")).toBe(true);
  });

  it("rejects OAuth / zero-config providers", () => {
    expect(isCookieProvider("Anthropic Account Quota")).toBe(false);
    expect(isCookieProvider("OpenAI Account Quota")).toBe(false);
    expect(isCookieProvider("xAI/Grok")).toBe(false);
  });
});
