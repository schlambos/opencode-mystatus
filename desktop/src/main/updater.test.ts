import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { app } from "electron";

// Mock `electron` so `app.isPackaged` is controllable per test. The updater
// module imports `app` at module scope, so we mock before import.
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
}));

import { createUpdater } from "./updater.js";

describe("createUpdater gate", () => {
  const originalEnv = process.env["MYSTATUS_ENABLE_UPDATES"];

  beforeEach(() => {
    delete process.env["MYSTATUS_ENABLE_UPDATES"];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["MYSTATUS_ENABLE_UPDATES"];
    } else {
      process.env["MYSTATUS_ENABLE_UPDATES"] = originalEnv;
    }
  });

  it("Given dev build (not packaged) When createUpdater Then returns disabled handle", () => {
    vi.mocked(app).isPackaged = false;
    process.env["MYSTATUS_ENABLE_UPDATES"] = "1";

    const updater = createUpdater();
    expect(updater.enabled).toBe(false);
  });

  it("Given packaged build without opt-in env When createUpdater Then returns disabled handle", () => {
    vi.mocked(app).isPackaged = true;
    delete process.env["MYSTATUS_ENABLE_UPDATES"];

    const updater = createUpdater();
    expect(updater.enabled).toBe(false);
  });

  it("Given packaged build with opt-in env When createUpdater Then returns enabled handle", () => {
    vi.mocked(app).isPackaged = true;
    process.env["MYSTATUS_ENABLE_UPDATES"] = "1";

    const updater = createUpdater();
    expect(updater.enabled).toBe(true);
  });

  it("Given disabled handle When start/stop Then no-ops without throwing", () => {
    vi.mocked(app).isPackaged = false;

    const updater = createUpdater();
    expect(() => updater.start()).not.toThrow();
    expect(() => updater.stop()).not.toThrow();
  });
});