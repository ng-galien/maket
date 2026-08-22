import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/server",
      "packages/client",
      "packages/shared",
      "packages/stdio-bridge",
      "packages/runtime",
      "packages/desktop",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "clover", "json-summary"],
      thresholds: {
        statements: 78,
        branches: 63,
        functions: 80,
        lines: 80,
      },
    },
  },
});
