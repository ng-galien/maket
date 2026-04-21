/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		name: "client",
		root: __dirname,
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		environment: "jsdom",
		globals: false,
		setupFiles: ["./src/test-setup.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "json-summary"],
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"**/*.test.{ts,tsx}",
				"src/main.tsx",
				"src/store/types.ts",
				"src/i18n/**",
				"src/test-setup.ts",
			],
			thresholds: {
				"src/store/**": {
					lines: 80,
					statements: 80,
					functions: 80,
					branches: 70,
				},
			},
		},
	},
});
