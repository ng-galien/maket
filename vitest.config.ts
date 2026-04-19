import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "public/**"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/server/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/types.ts",
        // gmail-client wraps googleapis (network I/O) — integration-tested
        // at the plugin level (phase 3), not unit-tested.
        "packages/server/src/services/gmail-client.ts",
      ],
      // Quality gate L3 — enforce coverage on the refactored layers.
      // Raise thresholds when lower layers are migrated.
      thresholds: {
        "packages/server/src/core/**": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 80,
        },
        "packages/server/src/services/**": {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 70,
        },
      },
    },
  },
});
