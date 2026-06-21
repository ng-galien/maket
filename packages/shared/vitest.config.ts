import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "shared",
		root: __dirname,
		include: ["src/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		environment: "node",
	},
});
