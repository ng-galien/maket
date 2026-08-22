import { existsSync, readFileSync, watch, writeFileSync } from "node:fs";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WorkspaceStateSignal } from "@maket/shared";
import express, {
	type Express,
	type NextFunction,
	type Request,
	type Response,
} from "express";
import { type WebSocket, WebSocketServer } from "ws";
import { type BootstrapInputs, createAppContainer } from "./bootstrap.js";
import { assertActivityContract } from "./core/activity-contract.js";
import type { ToolHandler } from "./core/container.js";
import { registerToolPacks } from "./core/tool-pack-registry.js";
import { isLoopbackHost, isLoopbackOrigin } from "./lib/local-origin.js";
import { mountRoutes } from "./routes/index.js";
import { registerServerEvents } from "./server-events.js";
import type { Annotations } from "./services/annotations.js";
import type { AssetsService } from "./services/assets.js";
import type { Bus } from "./services/bus.js";
import type { CollectionCursors } from "./services/collection-cursor.js";
import type { Collections } from "./services/collections.js";
import type { Config } from "./services/config.js";
import { createConfig, loadEnvFile } from "./services/config.js";
import type { DocumentRenderer } from "./services/document-renderer.js";
import type { Documents } from "./services/documents.js";
import type { WorkspaceCommandHandler } from "./services/ws-handler/index.js";
import type { WsLike, WsRegistry } from "./services/ws-registry.js";
import { assetsPack } from "./tools/assets.js";
import { canvasPack } from "./tools/canvas.js";
import { chartesPack } from "./tools/chartes.js";
import { collectionsPack } from "./tools/collections.js";
import { documentsPack } from "./tools/documents.js";
import { gmailPack } from "./tools/gmail.js";
import { htmlPack } from "./tools/html.js";
import { learnPack } from "./tools/learn.js";
import { mermaidPack } from "./tools/mermaid.js";
import { pagesPack } from "./tools/pages.js";
import { pdfPack } from "./tools/pdf.js";
import { previewPack } from "./tools/preview.js";
import { statePack } from "./tools/state.js";
import { workspacePack } from "./tools/workspace.js";

export { createConfig } from "./services/config.js";

export interface MaketServer {
	readonly config: Config;
	readonly url: string;
	close(): Promise<void>;
}

export interface StartMaketServerOptions {
	config?: Config;
	bootstrap?: Omit<BootstrapInputs, "config">;
	loadEnvironment?: boolean;
	log?: (...values: unknown[]) => void;
}

type AppContainer = ReturnType<typeof createAppContainer>;
type ServerLog = (...values: unknown[]) => void;

interface RuntimeServices {
	assets: AssetsService;
	bus: Bus;
	collections: Collections;
	collectionCursors: CollectionCursors;
	documents: Documents;
	documentRenderer: DocumentRenderer;
	pending: Annotations;
	wsHandler: WorkspaceCommandHandler;
	wsRegistry: WsRegistry;
}

interface RunningTransports {
	http: HttpServer;
	wss: WebSocketServer;
	url: string;
	publicWatcher: ReturnType<typeof watch> | null;
}

const toolPacks = [
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
];

const toolPackManifest = {
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
};

function closeHttpServer(server: HttpServer): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
		server.closeAllConnections();
	});
}

function createServerLog(config: Config, override?: ServerLog): ServerLog {
	if (override) return override;
	const logFile = join(
		config.DATA_DIR || join(homedir(), ".maket"),
		"server.log",
	);
	return (...values: unknown[]) => {
		const line = `${new Date().toISOString()} ${values.join(" ")}\n`;
		process.stderr.write(line);
		try {
			writeFileSync(logFile, line, { flag: "a" });
		} catch {}
	};
}

// The composition root resolves one typed view of the Awilix service graph.
// code-moniker: ignore[smell-feature-envy-local]
function resolveRuntimeServices(container: AppContainer): RuntimeServices {
	return {
		assets: container.resolve<AssetsService>("assets"),
		bus: container.resolve<Bus>("bus"),
		collections: container.resolve<Collections>("collections"),
		collectionCursors:
			container.resolve<CollectionCursors>("collectionCursors"),
		documents: container.resolve<Documents>("documents"),
		documentRenderer: container.resolve<DocumentRenderer>("documentRenderer"),
		pending: container.resolve<Annotations>("pending"),
		wsHandler: container.resolve<WorkspaceCommandHandler>("wsHandler"),
		wsRegistry: container.resolve<WsRegistry>("wsRegistry"),
	};
}

function prepareDocuments(services: RuntimeServices, log: ServerLog): void {
	const migration = services.assets.migrateLegacyThumbs();
	if (migration.migrated || migration.orphansDeleted || migration.ambiguous) {
		log(
			`[boot] Thumb migration: migrated=${migration.migrated} orphans=${migration.orphansDeleted} ambiguous=${migration.ambiguous}`,
		);
	}
	log("[boot] Loading documents...");
	services.documents.loadAll();
	log("[boot] Documents loaded");
}

function registerExecutableTools(
	container: AppContainer,
	log: ServerLog,
): Map<string, ToolHandler> {
	const { loadedPacks, toolRegistry } = registerToolPacks(
		container,
		toolPackManifest,
		toolPacks,
	);
	assertActivityContract(toolRegistry);
	log(`[boot] Plugins loaded: ${loadedPacks.join(", ")}`);
	return toolRegistry;
}

function assertManifestMatchesRegistry(
	config: Config,
	toolRegistry: ReadonlyMap<string, ToolHandler>,
): void {
	const manifestPath = join(config.PACKAGE_DIR, "manifest.json");
	if (!existsSync(manifestPath)) return;
	const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
		tools?: { name: string }[];
	};
	const manifestNames = new Set(
		(manifest.tools || []).map((tool) => tool.name),
	);
	const registryNames = new Set(toolRegistry.keys());
	const onlyInManifest = [...manifestNames].filter(
		(name) => !registryNames.has(name),
	);
	const onlyInRegistry = [...registryNames].filter(
		(name) => !manifestNames.has(name),
	);
	if (onlyInManifest.length || onlyInRegistry.length) {
		throw new Error(
			`manifest.json ↔ toolRegistry drift — in manifest only: [${onlyInManifest.join(", ")}]; in registry only: [${onlyInRegistry.join(", ")}]`,
		);
	}
}

function localRequestGuard(req: Request, res: Response, next: NextFunction) {
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
}

function contentSecurityPolicy(
	_req: Request,
	res: Response,
	next: NextFunction,
) {
	res.setHeader(
		"Content-Security-Policy",
		"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src * data: blob:; connect-src 'self' ws: wss: http: https:; script-src 'self' 'unsafe-eval'",
	);
	next();
}

function createHttpApp(config: Config, container: AppContainer): Express {
	const app = express();
	app.disable("x-powered-by");
	app.use(express.json({ limit: "5mb" }));
	app.use(localRequestGuard);
	app.use(contentSecurityPolicy);
	mountRoutes(app, container);
	app.use(express.static(config.PUBLIC_DIR, { maxAge: "1d" }));
	return app;
}

function acceptsWebSocketRequest(req: IncomingMessage): boolean {
	return (
		isLoopbackHost(req.headers.host) &&
		(!req.headers.origin || isLoopbackOrigin(req.headers.origin))
	);
}

function createWebSocketServer(http: HttpServer): WebSocketServer {
	return new WebSocketServer({
		server: http,
		verifyClient: ({ req }, callback) => {
			if (acceptsWebSocketRequest(req)) {
				callback(true);
				return;
			}
			callback(false, 403, "Forbidden");
		},
	});
}

// WebSocket connection setup is the intentional adapter between wire state and domain services.
// code-moniker: ignore[smell-feature-envy-local]
function handleWebSocketConnection(
	ws: WebSocket,
	services: RuntimeServices,
	log: ServerLog,
): void {
	const {
		collections,
		collectionCursors,
		documents,
		documentRenderer,
		pending,
		wsHandler,
		wsRegistry,
	} = services;
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
		} catch (error) {
			log(
				`WS message error: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	});
	ws.on("close", () => wsRegistry.remove(ws as unknown as WsLike));
}

function listen(http: HttpServer, config: Config): Promise<string> {
	return new Promise((resolve, reject) => {
		const onError = (error: Error) => reject(error);
		http.once("error", onError);
		http.listen(config.PORT, config.HOST, () => {
			http.off("error", onError);
			const address = http.address();
			const port =
				typeof address === "object" && address ? address.port : config.PORT;
			resolve(`http://${config.HOST}:${port}`);
		});
	});
}

function watchPublicFiles(
	config: Config,
	wsRegistry: WsRegistry,
	log: ServerLog,
): ReturnType<typeof watch> | null {
	if (
		config.COMPILED ||
		config.PACKAGED ||
		!existsSync(join(config.PACKAGE_DIR, "public"))
	) {
		return null;
	}
	let reloadTimer: ReturnType<typeof setTimeout> | null = null;
	return watch(join(config.PACKAGE_DIR, "public"), { recursive: true }, () => {
		if (reloadTimer) clearTimeout(reloadTimer);
		reloadTimer = setTimeout(() => {
			wsRegistry.broadcast({ type: "reload" });
			log("Live reload triggered");
		}, 200);
	});
}

async function startTransports(
	config: Config,
	container: AppContainer,
	services: RuntimeServices,
	log: ServerLog,
): Promise<RunningTransports> {
	const app = createHttpApp(config, container);
	const http = createServer(app);
	const wss = createWebSocketServer(http);
	wss.on("connection", (ws) => handleWebSocketConnection(ws, services, log));
	const url = await listen(http, config);
	log(`[boot] HTTP listening on ${new URL(url).host}`);
	log(`Maket: ${url}`);
	http.on("error", (error) =>
		log(
			`[boot] HTTP error: ${(error as NodeJS.ErrnoException).code || error.message}`,
		),
	);
	return {
		http,
		wss,
		url,
		publicWatcher: watchPublicFiles(config, services.wsRegistry, log),
	};
}

// Server startup is the composition root and therefore intentionally coordinates independent owners.
// code-moniker: ignore[smell-feature-envy-local]
export async function startMaketServer(
	options: StartMaketServerOptions = {},
): Promise<MaketServer> {
	if (options.loadEnvironment !== false) loadEnvFile();
	const config = options.config ?? createConfig();
	const log = createServerLog(config, options.log);
	log("[boot] Building Awilix container...");
	const container = createAppContainer({ ...options.bootstrap, config });
	const services = resolveRuntimeServices(container);
	prepareDocuments(services, log);
	const registry = registerExecutableTools(container, log);
	try {
		assertManifestMatchesRegistry(config, registry);
	} catch (error) {
		log(`[boot] ${error instanceof Error ? error.message : String(error)}`);
		throw error;
	}
	registerServerEvents({ ...services });
	const transports = await startTransports(config, container, services, log);
	log("[boot] MCP endpoint ready at /mcp");
	let closed = false;
	return {
		config,
		url: transports.url,
		async close() {
			if (closed) return;
			closed = true;
			transports.publicWatcher?.close();
			for (const client of transports.wss.clients) client.terminate();
			transports.wss.close();
			if (transports.http.listening) {
				await closeHttpServer(transports.http);
			}
			await container.dispose();
		},
	};
}
