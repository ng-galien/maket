import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	Client,
	StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { AwilixContainer } from "awilix";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppContainer } from "../bootstrap.js";
import { registerToolPacks } from "../core/tool-pack-registry.js";
import { type Config, createConfig, ensureDirs } from "../services/config.js";
import type { Documents } from "../services/documents.js";
import { createSQLiteStore, type Store } from "../services/store.js";
import { documentsPack } from "../tools/documents.js";
import { createDocument } from "../types.js";

const HISTORICAL_V1_BUNDLE = Buffer.from(
	readFileSync(
		new URL("./fixtures/historical-v1.maket.b64", import.meta.url),
		"utf8",
	).trim(),
	"base64",
);

interface TestRuntime {
	dir: string;
	config: Config;
	container: AwilixContainer;
	store: Store;
	documents: Documents;
	client: Client;
	close(): Promise<void>;
}

const runtimes: TestRuntime[] = [];

describe("bundle export/import through Streamable HTTP MCP", () => {
	afterEach(async () => {
		for (const runtime of runtimes.splice(0).reverse()) {
			await runtime.close();
			await runtime.container.dispose();
			runtime.store.close();
			rmSync(runtime.dir, { recursive: true, force: true });
		}
	});

	it("round-trips asset bytes and preserves a local asset on collision", async () => {
		const source = await createRuntime("maket-mcp-bundle-source-");
		const document = createDocument({
			name: "asset-poster",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					name: "P1",
					elements: [],
					html: '<img src="/assets/logo.png">',
				},
			],
		});
		source.store.saveDoc(document);
		writeFileSync(join(source.config.ASSETS_DIR, "logo.png"), "bundle-logo");
		source.documents.loadAll();

		const exportResult = await callMcp(source, "maket_doc", {
			action: "export",
			doc: "asset-poster",
		});
		expect(exportResult.isError).toBeUndefined();
		const bundlePath = resultText(exportResult).match(/→ (\S+\.maket)/)?.[1];
		expect(bundlePath).toBeDefined();

		const target = await createRuntime("maket-mcp-bundle-target-");
		const firstImport = await callMcp(target, "maket_doc", {
			action: "import",
			input: bundlePath,
		});
		expect(firstImport.isError).toBeUndefined();
		expect(resultText(firstImport)).toContain("Assets: 1 written");
		expect(
			readFileSync(join(target.config.ASSETS_DIR, "logo.png"), "utf8"),
		).toBe("bundle-logo");
		expect(target.documents.resolveOrLoad("asset-poster")?.pages[0]?.html).toBe(
			'<img src="/assets/logo.png">',
		);

		writeFileSync(join(target.config.ASSETS_DIR, "logo.png"), "local-logo");
		const collisionImport = await callMcp(target, "maket_doc", {
			action: "import",
			input: bundlePath,
		});
		expect(collisionImport.isError).toBeUndefined();
		expect(resultText(collisionImport)).toContain(
			"1 skipped (already present)",
		);
		expect(
			readFileSync(join(target.config.ASSETS_DIR, "logo.png"), "utf8"),
		).toBe("local-logo");
	});

	it("imports a frozen Maket 1.2 v1 bundle", async () => {
		const target = await createRuntime("maket-mcp-v1-target-");
		const bundlePath = join(target.config.EXPORTS_DIR, "historical-v1.maket");
		writeFileSync(bundlePath, HISTORICAL_V1_BUNDLE);

		const result = await callMcp(target, "maket_doc", {
			action: "import",
			input: bundlePath,
		});

		expect(result.isError).toBeUndefined();
		expect(resultText(result)).toContain(
			`Imported from ${bundlePath} (bundle v1`,
		);
		expect(target.documents.resolveOrLoad("legacy-poster")).toEqual(
			expect.objectContaining({
				name: "legacy-poster",
				category: "archive",
			}),
		);
		expect(target.store.loadCharte("legacy-brand")).toEqual(
			expect.objectContaining({
				name: "legacy-brand",
				tokens: { color: { primary: "#112233" } },
			}),
		);
	});

	it("returns an MCP tool error when a portable dependency cannot be persisted", async () => {
		const target = await createRuntime("maket-mcp-import-error-");
		const bundlePath = join(target.config.EXPORTS_DIR, "historical-v1.maket");
		writeFileSync(bundlePath, HISTORICAL_V1_BUNDLE);
		vi.spyOn(target.store, "saveCharte").mockImplementationOnce(() => {
			throw new Error("charte database is read-only");
		});

		const result = await callMcp(target, "maket_doc", {
			action: "import",
			input: bundlePath,
		});

		expect(result.isError).toBe(true);
		expect(resultText(result)).toBe(
			'Could not import bundle: Could not import charte "legacy-brand": charte database is read-only',
		);
	});
});

async function createRuntime(prefix: string): Promise<TestRuntime> {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	const config = createConfig({ env: { MAKET_DATA_DIR: dir } });
	ensureDirs(config);
	const store = createSQLiteStore(":memory:");
	const container = createAppContainer({
		config,
		ensure: false,
		store,
		browserPool: {
			async get(): Promise<never> {
				throw new Error("Browser rendering is not used by this test");
			},
			async dispose() {},
		},
	});
	registerToolPacks(container, { packs: { documents: {} } }, [documentsPack]);
	const documents = container.resolve<Documents>("documents");
	documents.loadAll();

	const app = express();
	app.use(express.json());
	app.use(container.resolve("mcpRouter"));
	const server = await startNetworkApp(app);
	const client = new Client(
		{ name: "maket-bundle-integration", version: "1" },
		{ versionNegotiation: { mode: "auto" } },
	);
	await client.connect(
		new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/mcp`)),
	);
	const runtime = {
		dir,
		config,
		container,
		store,
		documents,
		client,
		close: async () => {
			await client.close();
			await server.close();
		},
	};
	runtimes.push(runtime);
	return runtime;
}

async function startNetworkApp(app: express.Express): Promise<{
	baseUrl: string;
	close(): Promise<void>;
}> {
	const server = createServer(app);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Expected a TCP test server address");
	}
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}

async function callMcp(
	runtime: TestRuntime,
	name: string,
	args: Record<string, unknown>,
): Promise<CallToolResult> {
	return runtime.client.callTool({ name, arguments: args });
}

function resultText(result: CallToolResult): string {
	const item = result.content[0];
	if (item?.type !== "text") throw new Error("Expected MCP text result");
	return item.text;
}
