import { test, expect, _electron } from "@playwright/test";

// Placeholder — the real shell spec lands in todo 4. Kept here so the
// playwright config has a test dir and `test:e2e` is runnable end-to-end.
test.describe("desktop shell (placeholder)", () => {
  test("config loads", () => {
    expect(_electron).toBeDefined();
  });
});