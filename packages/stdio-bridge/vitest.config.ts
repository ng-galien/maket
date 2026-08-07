import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "stdio-bridge",
		root: import.meta.dirname,
		include: ["src/**/*.test.ts"],
		exclude: ["**/node_modules/**"],
		environment: "node",
	},
});
