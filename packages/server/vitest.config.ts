import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "server",
		root: import.meta.dirname,
		include: ["src/**/*.test.ts", "*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		environment: "node",
		// Warm Jimp per worker so the first image-touching test doesn't eat the
		// wasm cold-start (~2–3 s) on top of its own budget.
		setupFiles: ["./tests/setup.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "json-summary"],
			include: ["src/**/*.ts"],
			exclude: [
				"**/*.test.ts",
				"**/types.ts",
				// gmail-client wraps googleapis (network I/O) — integration-tested
				// at the plugin level (phase 3), not unit-tested.
				"src/services/gmail-client.ts",
			],
			// Quality gate L3 — enforce coverage on the refactored layers.
			// Raise thresholds when lower layers are migrated.
			thresholds: {
				"src/core/**": {
					lines: 90,
					statements: 90,
					functions: 90,
					branches: 80,
				},
				"src/services/**": {
					lines: 80,
					statements: 80,
					functions: 80,
					branches: 70,
				},
			},
		},
	},
});
