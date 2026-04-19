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
		},
	},
});
