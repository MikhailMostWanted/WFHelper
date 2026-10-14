import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  // Loaded CI runners can miss the Electron mount timeout; local runs do not retry.
  retries: process.env.CI ? 2 : 0,
  fullyParallel: false,
  // File-level only, so tests keep sharing their beforeAll app; each spec gets its
  // own mkdtemp sandbox. Each app also starts a native OCR thread pool, so keep
  // CI at two apps per runner instead of oversubscribing its four vCPUs.
  workers: process.env.CI ? 2 : 4,
  reporter: [["list"]],
});
