import { defineConfig } from "vitest/config";

// Node-environment vitest config for the cross-repo integration regression
// (test/bmwRenderer.integration.test.ts). No jsdom needed: the renderer's
// ingest() path is pure state mutation; the WebSocket transport is untouched.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
