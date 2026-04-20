import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	build: {
		outDir: path.resolve(__dirname, "../../public"),
		emptyOutDir: false,
	},
	server: {
		proxy: {
			"/api": "http://localhost:3333",
			"/assets": "http://localhost:3333",
			"/ws": { target: "ws://localhost:3333", ws: true },
			// Server-rendered HTML routes — Vite falls back to the SPA shell if
			// these aren't proxied, swallowing the real response.
			"/print": "http://localhost:3333",
			"/auth": "http://localhost:3333",
			"/mcp": "http://localhost:3333",
		},
	},
});
