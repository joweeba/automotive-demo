import { defineConfig } from "vitest/config";

// Node-environment vitest config for the cross-repo integration regression
// (test/bmwRenderer.integration.test.ts). No jsdom needed: the renderer's
// ingest() path is pure state mutation; the WebSocket transport is untouched.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The LIVE cross-process E2E (test/e2e/**) needs the built Rust emulator binary and
    // spawns a real process + WebSocket, so it is NOT part of the default `npm test`
    // (unit + in-process regression). Run it with `npm run test:e2e` (see vitest.e2e.config.ts).
    exclude: ["test/e2e/**", "node_modules/**"],
  },
});
