import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Tests cover the pure logic only (chain assembly, flow-state derivation). The
// React components are verified by driving the real deployed app, see
// scripts/verify_live.py, rather than by asserting against a simulated DOM.
export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, ".") } },
  test: { environment: "node", include: ["lib/__tests__/**/*.test.ts"] },
});
