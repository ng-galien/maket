import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const PORT = process.env.MAKET_PORT ?? "24842";
const http = `http://localhost:${PORT}`;
const ws = `ws://localhost:${PORT}`;

export default defineConfig(({ mode }) => {
	const pagesBuild = mode === "pages";
	const input: Record<string, string> = pagesBuild
		? {
				viewer: path.resolve(import.meta.dirname, "viewer.html"),
				demo: path.resolve(import.meta.dirname, "demo.html"),
			}
		: {
				main: path.resolve(import.meta.dirname, "index.html"),
				viewer: path.resolve(import.meta.dirname, "viewer.html"),
				demo: path.resolve(import.meta.dirname, "demo.html"),
			};
	return {
		base: pagesBuild ? "./" : undefined,
		plugins: [react(), tailwindcss()],
		resolve: {
			alias: {
				"@": path.resolve(import.meta.dirname, "./src"),
			},
		},
		build: {
			// The shared hydration runtime is ~530 kB minified (~160 kB gzip).
			// Keep the warning budget aligned with the shipped transfer size.
			chunkSizeWarningLimit: 600,
			outDir: path.resolve(
				import.meta.dirname,
				pagesBuild ? "../../docs/app" : "../../public",
			),
			emptyOutDir: pagesBuild,
			rollupOptions: {
				input,
			},
		},
		server: {
			proxy: {
				"/api": http,
				"/assets": http,
				"/ws": { target: ws, ws: true },
				// Server-rendered HTML routes — Vite falls back to the SPA shell if
				// these aren't proxied, swallowing the real response.
				"/print": http,
				"/auth": http,
				"/mcp": http,
			},
		},
	};
});
