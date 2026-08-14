#!/usr/bin/env node

import {
	existsSync,
	mkdirSync,
	readFileSync,
	watch,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkspaceStateSignal } from "@maket/shared";
import express from "express";
import { WebSocketServer } from "ws";
import { createAppContainer } from "./src/bootstrap.js";
import { assertActivityContract } from "./src/core/activity-contract.js";
import { registerToolPacks } from "./src/core/tool-pack-registry.js";
import { isLoopbackHost, isLoopbackOrigin } from "./src/lib/local-origin.js";
import { mountRoutes } from "./src/routes/index.js";
import type { Annotations } from "./src/services/annotations.js";
import type { AssetsService } from "./src/services/assets.js";
import type { Bus } from "./src/services/bus.js";
import type { CollectionCursors } from "./src/services/collection-cursor.js";
import type { Collections } from "./src/services/collections.js";
import type { Config } from "./src/services/config.js";
import { loadEnvFile } from "./src/services/config.js";
import type { DocumentRenderer } from "./src/services/document-renderer.js";
import type { Documents } from "./src/services/documents.js";
import type { WorkspaceCommandHandler } from "./src/services/ws-handler/index.js";
import type { WsLike, WsRegistry } from "./src/services/ws-registry.js";
import { assetsPack } from "./src/tools/assets.js";
import { canvasPack } from "./src/tools/canvas.js";
import { chartesPack } from "./src/tools/chartes.js";
import { collectionsPack } from "./src/tools/collections.js";
import { documentsPack } from "./src/tools/documents.js";
import { gmailPack } from "./src/tools/gmail.js";
import { htmlPack } from "./src/tools/html.js";
import { learnPack } from "./src/tools/learn.js";
import { mermaidPack } from "./src/tools/mermaid.js";
import { pagesPack } from "./src/tools/pages.js";
import { pdfPack } from "./src/tools/pdf.js";
import { previewPack } from "./src/tools/preview.js";
import { statePack } from "./src/tools/state.js";
import { workspacePack } from "./src/tools/workspace.js";

const _logFile = join(
	process.env.MAKET_DATA_DIR || join(homedir(), ".maket"),
	"server.log",
);
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
const collections = appContainer.resolve<Collections>("collections");
const collectionCursors =
	appContainer.resolve<CollectionCursors>("collectionCursors");
const documents = appContainer.resolve<Documents>("documents");
const documentRenderer =
	appContainer.resolve<DocumentRenderer>("documentRenderer");
const wsRegistry = appContainer.resolve<WsRegistry>("wsRegistry");
const wsHandler = appContainer.resolve<WorkspaceCommandHandler>("wsHandler");
const assets = appContainer.resolve<AssetsService>("assets");
const pending = appContainer.resolve<Annotations>("pending");

const thumbMigration = assets.migrateLegacyThumbs();
if (
	thumbMigration.migrated ||
	thumbMigration.orphansDeleted ||
	thumbMigration.ambiguous
) {
	log(
		`[boot] Thumb migration: migrated=${thumbMigration.migrated} orphans=${thumbMigration.orphansDeleted} ambiguous=${thumbMigration.ambiguous}`,
	);
}

log("[boot] Loading documents...");
documents.loadAll();
log("[boot] Documents loaded");

const { loadedPacks, toolRegistry } = registerToolPacks(
	appContainer,
	{
		packs: {
			mermaid: {},
			assets: {},
			chartes: {},
			collections: {},
			state: {},
			learn: {},
			pages: {},
			documents: {},
			canvas: {},
			html: {},
			workspace: {},
			preview: {},
			pdf: {},
			gmail: {},
		},
	},
	[
		mermaidPack,
		assetsPack,
		chartesPack,
		collectionsPack,
		statePack,
		learnPack,
		pagesPack,
		documentsPack,
		canvasPack,
		htmlPack,
		workspacePack,
		previewPack,
		pdfPack,
		gmailPack,
	],
);
assertActivityContract(toolRegistry);
log(`[boot] Plugins loaded: ${loadedPacks.join(", ")}`);

// Cross-check: manifest.json tool list must match the resolved registry.
// Catches rename drift — renaming an MCP tool without updating manifest.json
// (or vice versa) now fails boot instead of quietly serving a mismatched surface.
try {
	const manifestPath = join(
		dirname(fileURLToPath(import.meta.url)),
		"..",
		"..",
		"manifest.json",
	);
	if (existsSync(manifestPath)) {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
			tools?: { name: string }[];
		};
		const manifestNames = new Set((manifest.tools || []).map((t) => t.name));
		const registryNames = new Set<string>(toolRegistry.keys());
		const onlyInManifest = [...manifestNames].filter(
			(n) => !registryNames.has(n),
		);
		const onlyInRegistry = [...registryNames].filter(
			(n) => !manifestNames.has(n),
		);
		if (onlyInManifest.length || onlyInRegistry.length) {
			throw new Error(
				`manifest.json ↔ toolRegistry drift — in manifest only: [${onlyInManifest.join(", ")}]; in registry only: [${onlyInRegistry.join(", ")}]`,
			);
		}
	}
} catch (e) {
	log(`[boot] ${(e as Error).message}`);
	throw e;
}

// ============================================================
// BUS LISTENERS — broadcast state & toasts to WS clients
// ============================================================
// code-moniker: ignore[smell-feature-envy-local]
// The server entrypoint is the intentional composition boundary for WS fan-out.
function broadcastDoc(
	docName: string,
	addToWorkspace = false,
	focus = false,
): void {
	const doc = documents.resolve(docName);
	if (!doc) return;
	wsRegistry.broadcast({
		type: "state",
		doc: documents.lightView(documentRenderer.render(doc), doc.activePage),
		documentState: documentRenderer.stateView(doc),
		docList: documents.list(),
		collections: collections.loadAll(),
		collectionCursors: collectionCursors.snapshot(),
		annotations: pending.all(),
		charteCss: documents.charteCss(doc),
		addToWorkspace,
		focus,
	});
}

// code-moniker: ignore[smell-feature-envy-local]
// The server entrypoint is the intentional composition boundary for atomic rename fan-out.
function broadcastRenamedDoc(oldName: string, docName: string): void {
	const doc = documents.resolve(docName);
	if (!doc) return;
	wsRegistry.broadcast({
		type: "doc_renamed",
		oldName,
		doc: documents.lightView(documentRenderer.render(doc), doc.activePage),
		documentState: documentRenderer.stateView(doc),
		docList: documents.list(),
		collections: collections.loadAll(),
		collectionCursors: collectionCursors.snapshot(),
		annotations: pending.all(),
		charteCss: documents.charteCss(doc),
	});
}

const LOAD_EVENTS = ["document:created", "document:loaded"] as const;
const MUTATION_EVENTS = [
	"document:saved",
	"document:deleted",
	"canvas:changed",
	"element:updated",
	"meta:updated",
] as const;

for (const evt of LOAD_EVENTS) {
	bus.on(evt, ({ docName }) => broadcastDoc(docName, true));
}
for (const evt of MUTATION_EVENTS) {
	bus.on(evt, ({ docName }) => broadcastDoc(docName));
}
bus.on("document:renamed", ({ oldName, docName }) =>
	broadcastRenamedDoc(oldName, docName),
);
bus.on("document-state:changed", ({ docName, paths, attached }) => {
	if (attached) {
		broadcastDoc(docName);
		return;
	}
	const doc = documents.resolve(docName);
	if (doc?.dataModel !== "state") return;
	const documentState = documentRenderer.stateView(doc);
	if (!documentState) return;
	wsRegistry.broadcast({
		type: "state_pages",
		docName,
		documentState,
		pages: documentRenderer.statePages(doc, paths),
		docList: documents.list(),
	});
});
bus.on("document:focused", ({ docName }) => broadcastDoc(docName, true, true));

bus.on("workspace:fit-view", () => {
	wsRegistry.broadcast({ type: "fit_view" });
});

bus.on("charte:updated", ({ name, css }) => {
	wsRegistry.broadcast({ type: "charte_updated", name, css });
});

bus.on("charte:removed", ({ name }) => {
	wsRegistry.broadcast({ type: "charte_removed", name });
});

function broadcastCollections(): void {
	wsRegistry.broadcast({
		type: "collections_changed",
		collections: collections.loadAll(),
	});
}

bus.on("collection:saved", broadcastCollections);
bus.on("collection:deleted", broadcastCollections);

bus.on("collection-cursor:changed", () => {
	wsRegistry.broadcast({
		type: "collection_cursors",
		cursors: collectionCursors.snapshot(),
	});
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
	wsRegistry.broadcast({ type: "doc_removed", name: docName });
	wsRegistry.broadcast({
		type: "annotations_changed",
		annotations: pending.all(),
	});
});

bus.on("messages:acked", ({ ids }) => {
	wsRegistry.broadcast({ type: "ack_messages", ids });
});

bus.on("annotations:changed", () => {
	wsRegistry.broadcast({
		type: "annotations_changed",
		annotations: pending.all(),
	});
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
const { COMPILED, PACKAGED, PACKAGE_DIR, PUBLIC_DIR, PORT, HOST } = config;
const app = express();
app.disable("x-powered-by");
// 5 MB is well above legitimate MCP/JSON payloads (largest doc bodies are
// kilobytes; image data goes through the dedicated /api/upload route which
// applies its own bigger cap). Hard limit blocks DoS via giant JSON bodies.
app.use(express.json({ limit: "5mb" }));

// Origin / Host guard — first line of defence against CSRF from any visited
// site and against DNS-rebinding attacks. The whole product is local-only;
// any request whose Host header isn't loopback, or whose Origin (when present)
// isn't loopback, is hostile by definition.
app.use((req, res, next) => {
	if (!isLoopbackHost(req.headers.host)) {
		res.status(403).end();
		return;
	}
	const origin = req.headers.origin;
	if (origin && !isLoopbackOrigin(origin)) {
		res.status(403).end();
		return;
	}
	next();
});

// CSP: block inline scripts to mitigate XSS in dangerouslySetInnerHTML canvas.
// Ajv compiles collection schemas with new Function in the packaged client.
// Keep inline scripts blocked while allowing that local validation path.
app.use((_req, res, next) => {
	res.setHeader(
		"Content-Security-Policy",
		"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src * data: blob:; connect-src 'self' ws: wss: http: https:; script-src 'self' 'unsafe-eval'",
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
const wss = new WebSocketServer({
	server: http,
	verifyClient: ({ req }, cb) => {
		// Same loopback gate as the HTTP middleware — browsers do not enforce
		// same-origin on WebSocket handshakes, so we have to.
		if (!isLoopbackHost(req.headers.host)) {
			cb(false, 403, "Forbidden");
			return;
		}
		const origin = req.headers.origin;
		if (origin && !isLoopbackOrigin(origin)) {
			cb(false, 403, "Forbidden");
			return;
		}
		cb(true);
	},
});

wss.on("connection", (ws) => {
	wsRegistry.add(ws as unknown as WsLike);
	const docs = documents.all();
	const firstDoc = docs.size > 0 ? (docs.values().next().value ?? null) : null;
	const initialState: WorkspaceStateSignal = {
		type: "state",
		doc: documents.lightView(
			firstDoc ? documentRenderer.render(firstDoc) : null,
		),
		documentState: firstDoc ? documentRenderer.stateView(firstDoc) : null,
		docList: documents.list(),
		collections: collections.loadAll(),
		collectionCursors: collectionCursors.snapshot(),
		annotations: pending.all(),
		charteCss: documents.charteCss(firstDoc ?? null),
		addToWorkspace: true,
	};
	ws.send(JSON.stringify(initialState));
	ws.on("message", (raw) => {
		try {
			wsHandler(JSON.parse(String(raw)), ws);
		} catch (e: any) {
			log(`WS message error: ${e?.message || e}`);
		}
	});
	ws.on("close", () => wsRegistry.remove(ws as unknown as WsLike));
});

function onListening() {
	const addr = http.address();
	const actualPort = typeof addr === "object" && addr ? addr.port : PORT;
	log(`[boot] HTTP listening on ${HOST}:${actualPort}`);
	log(`Maket: http://localhost:${actualPort}`);
}
http.on("error", (err: any) => {
	if (err.code === "EADDRINUSE") {
		log(`Port ${PORT} in use, using random port...`);
		http.listen(0, HOST, onListening);
	} else {
		log(`[boot] HTTP error: ${err.code || err.message}`);
	}
});
http.listen(PORT, HOST, onListening);

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
