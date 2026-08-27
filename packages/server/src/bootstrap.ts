/**
 * bootstrap — build the Awilix container with all services registered.
 *
 * Single place where concrete service implementations are wired to their
 * registration names. Handlers and tool packs resolve services from the
 * container by destructured parameter name.
 */

import type { AwilixContainer } from "awilix";
import { asFunction, asValue, createContainer } from "awilix";
import { createAppRouter } from "./routes/app.routes.js";
import { createAssetsRouter } from "./routes/assets.routes.js";
import { createChartesRouter } from "./routes/chartes.routes.js";
import { createExportRouter } from "./routes/export.routes.js";
import { createGmailRouter } from "./routes/gmail.routes.js";
import { createMcpRouter } from "./routes/mcp.routes.js";
import { createMcpHttpHandler } from "./routes/mcp-handler.js";
import { createOAuthRouter } from "./routes/oauth.routes.js";
import { createThumbnailRouter } from "./routes/thumbnail.routes.js";
import { createAnnotations } from "./services/annotations.js";
import { createAssetsService } from "./services/assets.js";
import type { BrowserPool } from "./services/browser-pool.js";
import { createBundleExportService } from "./services/bundle-export.js";
import { createBundleImportService } from "./services/bundle-import.js";
import { createBus } from "./services/bus.js";
import { createCollectionCursors } from "./services/collection-cursor.js";
import { createCollectionRenderer } from "./services/collection-renderer.js";
import { createCollections } from "./services/collections.js";
import { type Config, createConfig, ensureDirs } from "./services/config.js";
import { createDocumentRenderer } from "./services/document-renderer.js";
import { createDocumentStates } from "./services/document-states.js";
import { createDocuments, type Documents } from "./services/documents.js";
import {
	createGmailClient,
	type GmailClient,
} from "./services/gmail-client.js";
import { createLayoutService } from "./services/layout.js";
import { createMermaidDiagrams } from "./services/mermaid-diagrams.js";
import { createPdfService } from "./services/pdf.js";
import { createSettings } from "./services/settings.js";
import { createStateRenderer } from "./services/state-renderer.js";
import { createSQLiteStore, type Store } from "./services/store.js";
import { createThumbnailService } from "./services/thumbnail.js";
import { createWsHandler } from "./services/ws-handler/index.js";
import { createWsRegistry } from "./services/ws-registry.js";

/**
 * Test overrides for services whose concrete implementation is expensive or
 * side-effecting (SQLite file I/O, Gmail OAuth, document cache hydration).
 * Other services (`bus`, `layout`, `pdf`, `assets`, `wsRegistry`, `wsHandler`)
 * have no override because their default factories are cheap and deterministic
 * enough for integration tests — add one here if that stops being true.
 */
export interface BootstrapInputs {
	/** Optional pre-built config (tests). Defaults to `createConfig()`. */
	config?: Config;
	/** When true (default), ensures writable data dirs exist on disk. */
	ensure?: boolean;
	/** Optional Store override — tests pass an in-memory store. */
	store?: Store;
	/** Optional Documents override — tests inject a stub. */
	documents?: Documents;
	/** Optional GmailClient override — tests inject a stub. */
	gmailClient?: GmailClient;
	/** Optional render-browser override — Electron supplies its embedded
	 * Chromium while the standalone server uses Puppeteer. */
	browserPool?: BrowserPool;
	/** Owned render-browser factory. The headless entry point supplies the
	 * Puppeteer implementation; Electron supplies `browserPool` instead. */
	browserPoolFactory?: () => BrowserPool;
}

export function createAppContainer(
	inputs: BootstrapInputs = {},
): AwilixContainer {
	const config = inputs.config ?? createConfig();
	if (inputs.ensure !== false) ensureDirs(config);
	if (!inputs.browserPool && !inputs.browserPoolFactory) {
		throw new Error("A browser pool or browser pool factory is required");
	}

	const container = createContainer({ strict: true });

	container.register({
		config: asValue(config),

		bus: asFunction(createBus).singleton(),
		settings: asFunction(createSettings).singleton(),

		store: inputs.store
			? asValue(inputs.store)
			: asFunction(() => createSQLiteStore(config.DB_PATH))
					.singleton()
					.disposer((s) => s.close()),

		documents: inputs.documents
			? asValue(inputs.documents)
			: asFunction(createDocuments).singleton(),

		pending: asFunction(createAnnotations).singleton(),

		collections: asFunction(createCollections).singleton(),

		collectionRenderer: asFunction(createCollectionRenderer).singleton(),

		documentStates: asFunction(createDocumentStates).singleton(),

		stateRenderer: asFunction(createStateRenderer).singleton(),

		documentRenderer: asFunction(createDocumentRenderer).singleton(),

		collectionCursors: asFunction(createCollectionCursors).singleton(),

		bundleExportService: asFunction(createBundleExportService).singleton(),

		bundleImportService: asFunction(createBundleImportService).singleton(),

		wsRegistry: asFunction(createWsRegistry).singleton(),

		wsHandler: asFunction(createWsHandler).singleton(),

		assets: asFunction(() =>
			createAssetsService({ assetsDir: config.ASSETS_DIR }),
		).singleton(),

		gmailClient: inputs.gmailClient
			? asValue(inputs.gmailClient)
			: asFunction(() =>
					createGmailClient({ dataDir: config.DATA_DIR }),
				).singleton(),

		layout: asFunction(createLayoutService).singleton(),

		mermaidDiagrams: asFunction(createMermaidDiagrams).singleton(),

		browserPool: inputs.browserPool
			? asValue(inputs.browserPool)
			: asFunction(inputs.browserPoolFactory as () => BrowserPool)
					.singleton()
					.disposer((p) => p.dispose()),

		pdfService: asFunction(createPdfService).singleton(),

		thumbnailService: asFunction(createThumbnailService).singleton(),
	});

	container.register({
		container: asValue(container),
		mcpHttpHandler: asFunction(createMcpHttpHandler)
			.singleton()
			.disposer((handler) => handler.close()),
		appRouter: asFunction(createAppRouter).singleton(),
		assetsRouter: asFunction(createAssetsRouter).singleton(),
		chartesRouter: asFunction(createChartesRouter).singleton(),
		exportRouter: asFunction(createExportRouter).singleton(),
		thumbnailRouter: asFunction(createThumbnailRouter).singleton(),
		oauthRouter: asFunction(createOAuthRouter).singleton(),
		gmailRouter: asFunction(createGmailRouter).singleton(),
		mcpRouter: asFunction(createMcpRouter).singleton(),
	});

	return container;
}
