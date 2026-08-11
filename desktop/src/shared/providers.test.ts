import { describe, expect, it } from "vitest";
import { PROVIDER_IDS, PROVIDERS } from "./providers.js";

describe("shared provider registry", () => {
  it("keeps the desktop list aligned with the core registry, including synthetic", () => {
    expect(PROVIDERS).toHaveLength(19);
    expect(PROVIDER_IDS).toContain("synthetic");
    expect(new Set(PROVIDER_IDS).size).toBe(PROVIDER_IDS.length);
  });
});
