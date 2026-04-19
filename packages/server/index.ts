#!/usr/bin/env node

import { existsSync, mkdirSync, watch, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { WsStateMessage } from "@maket/shared";
import express from "express";
import { WebSocketServer } from "ws";
import { createAppContainer } from "./src/bootstrap.js";
import { registerToolPacks } from "./src/core/tool-pack-registry.js";
import { mountRoutes } from "./src/routes/index.js";
import type { Bus } from "./src/services/bus.js";
import type { Config } from "./src/services/config.js";
import { loadEnvFile } from "./src/services/config.js";
import type { Documents } from "./src/services/documents.js";
import type { WsMessageHandler } from "./src/services/ws-handler.js";
import type { WsLike, WsRegistry } from "./src/services/ws-registry.js";
import { assetsPack } from "./src/tools/assets.js";
import { canvasPack } from "./src/tools/canvas.js";
import { chartesPack } from "./src/tools/chartes.js";
import { documentsPack } from "./src/tools/documents.js";
import { gmailPack } from "./src/tools/gmail.js";
import { htmlPack } from "./src/tools/html.js";
import { mermaidPack } from "./src/tools/mermaid.js";
import { messagesPack } from "./src/tools/messages.js";
import { pagesPack } from "./src/tools/pages.js";
import { pdfPack } from "./src/tools/pdf.js";
import { previewPack } from "./src/tools/preview.js";

const _logFile = join(
	process.env.MAKET_DATA_DIR || join(homedir(), ".maket"),
	"server.log",
);
// biome-ignore lint/suspicious/noExplicitAny: log args are free-form
const log = (...a: any[]) => {
	const line = `${new Date().toISOString()} ${a.join(" ")}\n`;
	process.stderr.write(line);
	try {
		writeFileSync(_logFile, line, { flag: "a" });
	} catch {}
};

// Global error handlers — log to stderr + ~/.maket/crash.log
function crashLog(msg: string) {
	log(msg);
	try {
		const crashPath = join(homedir(), ".maket", "crash.log");
		mkdirSync(dirname(crashPath), { recursive: true });
		writeFileSync(crashPath, `${new Date().toISOString()} ${msg}\n`, {
			flag: "a",
		});
	} catch {}
}
process.on("uncaughtException", (err) => {
	crashLog(`[FATAL] Uncaught: ${err.stack || err.message}`);
	process.exit(1);
});
process.on("unhandledRejection", (reason) => {
	crashLog(
		`[FATAL] Rejection: ${reason instanceof Error ? reason.stack || reason.message : reason}`,
	);
	process.exit(1);
});

// ============================================================
// AWILIX CONTAINER — single source of truth for services + tool packs
// ============================================================
loadEnvFile();
log("[boot] Building Awilix container...");
const appContainer = createAppContainer();

const config = appContainer.resolve<Config>("config");
const bus = appContainer.resolve<Bus>("bus");
const documents = appContainer.resolve<Documents>("documents");
const wsRegistry = appContainer.resolve<WsRegistry>("wsRegistry");
const wsHandler = appContainer.resolve<WsMessageHandler>("wsHandler");

log("[boot] Loading documents...");
documents.loadAll();
log("[boot] Documents loaded");

const { loadedPacks } = registerToolPacks(
	appContainer,
	{
		packs: {
			mermaid: {},
			assets: {},
			chartes: {},
			pages: {},
			documents: {},
			canvas: {},
			html: {},
			messages: {},
			preview: {},
			pdf: {},
			gmail: {},
		},
	},
	[
		mermaidPack,
		assetsPack,
		chartesPack,
		pagesPack,
		documentsPack,
		canvasPack,
		htmlPack,
		messagesPack,
		previewPack,
		pdfPack,
		gmailPack,
	],
);
log(`[boot] Plugins loaded: ${loadedPacks.join(", ")}`);

// ============================================================
// BUS LISTENERS — broadcast state & toasts to WS clients
// ============================================================
function broadcastDoc(
	docName: string,
	addToWorkspace = false,
	focus = false,
): void {
	const doc = documents.resolve(docName);
	if (!doc) return;
	wsRegistry.broadcast({
		type: "state",
		doc: documents.lightView(doc),
		docList: documents.list(),
		charteCss: documents.charteCss(doc),
		addToWorkspace,
		focus,
	});
}

const LOAD_EVENTS = ["document:created", "document:loaded"] as const;
const MUTATION_EVENTS = [
	"document:saved",
	"document:deleted",
	"canvas:changed",
	"element:added",
	"element:updated",
	"element:deleted",
	"element:reordered",
	"elements:cleared",
	"meta:updated",
] as const;

for (const evt of LOAD_EVENTS) {
	bus.on(evt, ({ docName }) => broadcastDoc(docName, true));
}
for (const evt of MUTATION_EVENTS) {
	bus.on(evt, ({ docName }) => broadcastDoc(docName));
}

bus.on("charte:updated", ({ name, css }) => {
	wsRegistry.broadcast({ type: "charte_updated", name, css });
});

bus.on("toast", ({ text, level, duration }) => {
	wsRegistry.broadcast({
		type: "toast",
		text,
		level: level || "info",
		duration: duration || 3000,
	});
});

bus.on("document:deleted", ({ docName }) => {
	wsRegistry.broadcast({ type: "remove_doc", name: docName });
});

bus.on("messages:acked", ({ ids }) => {
	wsRegistry.broadcast({ type: "ack_messages", ids });
});

bus.on("assets:changed", () => {
	wsRegistry.broadcast({ type: "assets_changed" });
});

// Dispose container (closes SQLite + future-proofed disposers) on exit.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
	process.on(sig, () => {
		log(`Received ${sig}, shutting down...`);
		appContainer
			.dispose()
			.catch((e) => log(`Dispose error: ${e?.message || e}`))
			.finally(() => process.exit(0));
	});
}
process.on("exit", (code) => {
	log(`Process exit with code ${code}`);
});

// ============================================================
// WEB + WS SERVER
// ============================================================
const { COMPILED, PACKAGED, PACKAGE_DIR, PUBLIC_DIR, PORT } = config;
const app = express();
app.use(express.json());

// CSP: block inline scripts to mitigate XSS in dangerouslySetInnerHTML canvas
app.use((_req, res, next) => {
	res.setHeader(
		"Content-Security-Policy",
		"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src * data: blob:; connect-src 'self' ws: wss: http: https:; script-src 'self'",
	);
	next();
});

// All HTTP routes — mounted from the container.
mountRoutes(app, appContainer);

// Public static directory (served after the `/` shell route to let the shell
// inject config; placed here so Express doesn't intercept `/` with the static
// middleware's index.html).
app.use(express.static(PUBLIC_DIR, { maxAge: "1d" }));

const http = createServer(app);
const wss = new WebSocketServer({ server: http });

wss.on("connection", (ws) => {
	wsRegistry.add(ws as unknown as WsLike);
	const docs = documents.all();
	const firstDoc = docs.size > 0 ? (docs.values().next().value ?? null) : null;
	const initialState: WsStateMessage = {
		type: "state",
		doc: documents.lightView(firstDoc ?? null),
		docList: documents.list(),
		charteCss: documents.charteCss(firstDoc ?? null),
		addToWorkspace: true,
	};
	ws.send(JSON.stringify(initialState));
	ws.on("message", (raw) => {
		try {
			wsHandler(JSON.parse(String(raw)), ws);
			// biome-ignore lint/suspicious/noExplicitAny: error shape varies
		} catch (e: any) {
			log(`WS message error: ${e?.message || e}`);
		}
	});
	ws.on("close", () => wsRegistry.remove(ws as unknown as WsLike));
});

function onListening() {
	const addr = http.address();
	const actualPort = typeof addr === "object" && addr ? addr.port : PORT;
	log(`[boot] HTTP listening on port ${actualPort}`);
	log(`Maket: http://maket.127.0.0.1.nip.io:${actualPort}`);
}
// biome-ignore lint/suspicious/noExplicitAny: error shape varies
http.on("error", (err: any) => {
	if (err.code === "EADDRINUSE") {
		log(`Port ${PORT} in use, using random port...`);
		http.listen(0, onListening);
	} else {
		log(`[boot] HTTP error: ${err.code || err.message}`);
	}
});
http.listen(PORT, onListening);

// Dev-only: watch public/ → live reload browsers when client build completes
if (!COMPILED && !PACKAGED && existsSync(join(PACKAGE_DIR, "public"))) {
	let reloadTimer: ReturnType<typeof setTimeout> | null = null;
	watch(join(PACKAGE_DIR, "public"), { recursive: true }, () => {
		if (reloadTimer) clearTimeout(reloadTimer);
		reloadTimer = setTimeout(() => {
			wsRegistry.broadcast({ type: "reload" });
			log("Live reload triggered");
		}, 200);
	});
}

log("[boot] MCP endpoint ready at /mcp");
