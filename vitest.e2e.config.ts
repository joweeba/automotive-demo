import { defineConfig } from "vitest/config";

// LIVE cross-process E2E config: runs ONLY test/e2e/**. These spawn the real
// `emulator --features ui --ui` binary as a child process and drive it over a real
// WebSocket (intent drive + inbound-audio round-trip), asserting HER bmwRenderer
// reflects the live stream. Kept separate from the default `npm test` because it needs
// the built binary (EMULATOR_BIN) and a longer timeout. Run: `npm run test:e2e`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/e2e/**/*.test.ts"],
    // Driving all 806 variants live over one WS is the long pole; give the suite room.
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // One process at a time — the harness owns a child emulator + socket.
    fileParallelism: false,
  },
});
