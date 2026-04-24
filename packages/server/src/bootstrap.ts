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
import { createOAuthRouter } from "./routes/oauth.routes.js";
import { createThumbnailRouter } from "./routes/thumbnail.routes.js";
import { createAssetsService } from "./services/assets.js";
import { createBrowserPool } from "./services/browser-pool.js";
import { createBus } from "./services/bus.js";
import { type Config, createConfig, ensureDirs } from "./services/config.js";
import { createDocuments, type Documents } from "./services/documents.js";
import {
	createGmailClient,
	type GmailClient,
} from "./services/gmail-client.js";
import { createLayoutService } from "./services/layout.js";
import { createPdfService } from "./services/pdf.js";
import { createPending } from "./services/pending.js";
import { createSQLiteStore, type Store } from "./services/store.js";
import { createThumbnailService } from "./services/thumbnail.js";
import { createWsBridge } from "./services/ws-bridge.js";
import { createWsHandler } from "./services/ws-handler.js";
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
}

export function createAppContainer(
	inputs: BootstrapInputs = {},
): AwilixContainer {
	const config = inputs.config ?? createConfig();
	if (inputs.ensure !== false) ensureDirs(config);

	const container = createContainer({ strict: true });

	container.register({
		config: asValue(config),

		bus: asFunction(createBus).singleton(),

		store: inputs.store
			? asValue(inputs.store)
			: asFunction(() => createSQLiteStore(config.DB_PATH))
					.singleton()
					.disposer((s) => s.close()),

		documents: inputs.documents
			? asValue(inputs.documents)
			: asFunction(createDocuments).singleton(),

		pending: asFunction(createPending).singleton(),

		wsRegistry: asFunction(createWsRegistry).singleton(),

		wsBridge: asFunction(createWsBridge).singleton(),

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

		browserPool: asFunction(createBrowserPool)
			.singleton()
			.disposer((p) => p.dispose()),

		pdfService: asFunction(createPdfService).singleton(),

		thumbnailService: asFunction(createThumbnailService).singleton(),
	});

	// Route factories — resolved by `mountRoutes` at server boot.
	container.register({
		container: asValue(container),
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
