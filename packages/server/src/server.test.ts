import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { startMaketServer } from "./server.js";
import { createConfig } from "./services/config.js";
import { createSQLiteStore } from "./services/store.js";
import { createDocument } from "./types.js";

const directories: string[] = [];
const browserPool = {
	async get(): Promise<never> {
		throw new Error("Browser rendering is not used by this test");
	},
	async dispose() {},
};

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("embedded Maket server", () => {
	it("admits only the configured HTTPS proxy context across HTTP, browser exports and WebSocket", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "maket-trusted-origin-"));
		directories.push(dataDir);
		const publicDir = join(dataDir, "public");
		mkdirSync(publicDir);
		writeFileSync(
			join(publicDir, "index.html"),
			"<!doctype html><title>Origin test</title>",
		);
		const origin = "https://maket.example.ts.net:18448";
		const authority = new URL(origin).host;
		const config = createConfig({
			env: {
				MAKET_DATA_DIR: dataDir,
				MAKET_SETTINGS_FILE: join(dataDir, "settings.json"),
				MAKET_PORT: "0",
				MAKET_PUBLIC_DIR: publicDir,
				MAKET_TRUSTED_ORIGINS: JSON.stringify([origin]),
			},
		});
		const server = await startMaketServer({
			config,
			bootstrap: { store: createSQLiteStore(":memory:"), browserPool },
			loadEnvironment: false,
			log: () => {},
		});
		const status = (path: string, headers: Record<string, string>) =>
			new Promise<number>((resolve, reject) => {
				const call = request(
					`${server.url}${path}`,
					{ headers },
					(response) => {
						response.resume();
						response.on("end", () => resolve(response.statusCode ?? 0));
					},
				);
				call.on("error", reject);
				call.end();
			});
		try {
			for (const host of [authority, new URL(server.url).host]) {
				const headers = {
					Host: host,
					Origin: origin,
					Referer: `${origin}/workspaces`,
				};
				expect(await status("/", headers)).toBe(200);
				expect(await status("/auto-page-size.js", headers)).toBe(200);
				const socket = new WebSocket(server.url.replace(/^http/, "ws"), {
					headers,
				});
				const received = once(socket, "message");
				await once(socket, "open");
				const [payload] = await received;
				expect(JSON.parse(String(payload))).toMatchObject({
					type: "state",
					structuredWorkspaces: expect.any(Array),
				});
				socket.close();
				await once(socket, "close");
			}
			const rejectedHeaders: Record<string, string>[] = [
				{ Host: "attacker.example", Origin: origin },
				{ Host: authority, Origin: "https://attacker.example" },
				{ Host: authority, Origin: "http://127.0.0.1" },
				{ Host: "maket.example.ts.net:18449", Origin: origin },
				{ Host: authority, Origin: `${origin}/path` },
				{
					Host: "attacker.example",
					"X-Forwarded-Host": authority,
					"X-Forwarded-Proto": "https",
				},
			];
			for (const headers of rejectedHeaders) {
				expect(await status("/", headers), JSON.stringify(headers)).toBe(403);
				const socket = new WebSocket(server.url.replace(/^http/, "ws"), {
					headers,
				});
				const rejected = new Promise<number>((resolve) =>
					socket.once("unexpected-response", (_req, response) => {
						resolve(response.statusCode ?? 0);
						socket.terminate();
					}),
				);
				socket.on("error", () => {});
				expect(await rejected).toBe(403);
			}
			expect(
				(
					await fetch(`${server.url}/auto-page-size.js`, {
						headers: { Host: authority, Referer: "https://attacker.example/" },
					})
				).status,
			).toBe(403);
		} finally {
			await server.close();
		}
	});

	it("exposes current settings and notifies its embedding host after a browser change", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "maket-embedded-settings-"));
		directories.push(dataDir);
		const config = createConfig({
			packageDir: resolve(import.meta.dirname, "../../.."),
			packaged: true,
			env: {
				MAKET_DATA_DIR: dataDir,
				MAKET_SETTINGS_FILE: join(dataDir, "settings.json"),
				MAKET_PORT: "0",
				MAKET_BIND_HOST: "127.0.0.1",
			},
		});
		const onSettingsChanged = vi.fn();
		const server = await startMaketServer({
			config,
			bootstrap: { store: createSQLiteStore(":memory:"), browserPool },
			loadEnvironment: false,
			log: () => {},
			onSettingsChanged,
		});
		const socket = new WebSocket(server.url.replace(/^http/, "ws"));

		try {
			await once(socket, "open");
			expect(server.settings().language).toBe("en");
			socket.send(
				JSON.stringify({ type: "settings_set", settings: { language: "fr" } }),
			);
			await vi.waitFor(() =>
				expect(onSettingsChanged).toHaveBeenCalledWith(
					expect.objectContaining({ language: "fr" }),
				),
			);
			expect(server.settings().language).toBe("fr");
		} finally {
			socket.close();
			await once(socket, "close");
			await server.close();
		}
	});

	it("opens a connection without imposing a document and answers a connection check to its sender only", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "maket-connection-state-"));
		directories.push(dataDir);
		const config = createConfig({
			packageDir: resolve(import.meta.dirname, "../../.."),
			packaged: true,
			env: {
				MAKET_DATA_DIR: dataDir,
				MAKET_SETTINGS_FILE: join(dataDir, "settings.json"),
				MAKET_PORT: "0",
				MAKET_BIND_HOST: "127.0.0.1",
			},
		});
		const store = createSQLiteStore(":memory:");
		store.saveDoc(
			createDocument({
				name: "first in list",
				canvas: {
					format: "A4",
					orientation: "portrait",
					w: 210,
					h: 297,
					bg: "#fff",
				},
			}),
		);
		const server = await startMaketServer({
			config,
			bootstrap: { store, browserPool },
			loadEnvironment: false,
			log: () => {},
		});
		const url = server.url.replace(/^http/, "ws");
		const reader = new WebSocket(url);
		const other = new WebSocket(url);
		const received = {
			reader: [] as { type: string }[],
			other: [] as { type: string }[],
		};
		reader.on("message", (raw) =>
			received.reader.push(JSON.parse(String(raw))),
		);
		other.on("message", (raw) => received.other.push(JSON.parse(String(raw))));

		try {
			await Promise.all([once(reader, "open"), once(other, "open")]);
			await vi.waitFor(() => {
				expect(received.reader).toHaveLength(2);
				expect(received.other).toHaveLength(2);
			});
			const [state, settings] = received.reader as [
				{ type: string; doc: unknown; docList: { name: string }[] },
				{ type: string },
			];
			expect(state.type).toBe("state");
			expect(state.doc).toBeNull();
			expect(state.docList.map((doc) => doc.name)).toEqual(["first in list"]);
			expect(settings.type).toBe("settings");

			reader.send(
				JSON.stringify({ type: "connection_check", requestId: "r1" }),
			);
			await vi.waitFor(() =>
				expect(received.reader.at(-1)).toEqual({
					type: "connection_checked",
					requestId: "r1",
				}),
			);
			expect(received.other.map((message) => message.type)).toEqual([
				"state",
				"settings",
			]);
		} finally {
			reader.close();
			other.close();
			await Promise.all([once(reader, "close"), once(other, "close")]);
			await server.close();
		}
	});

	it("starts on the requested workspace and closes through its public lifecycle", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "maket-embedded-server-"));
		directories.push(dataDir);
		const packageDir = resolve(import.meta.dirname, "../../..");
		const config = createConfig({
			packageDir,
			packaged: true,
			env: {
				MAKET_DATA_DIR: dataDir,
				MAKET_PORT: "0",
				MAKET_BIND_HOST: "127.0.0.1",
			},
		});
		config.PUBLIC_DIR = join(dataDir, "public");
		mkdirSync(config.PUBLIC_DIR, { recursive: true });
		writeFileSync(
			join(config.PUBLIC_DIR, "index.html"),
			"<!doctype html><title>{{TITLE}}</title><main>{{SUBTITLE}}</main>",
		);
		const store = createSQLiteStore(":memory:");
		const server = await startMaketServer({
			config,
			bootstrap: { store, browserPool },
			loadEnvironment: false,
			log: () => {},
		});

		const response = await fetch(server.url);
		expect(response.status).toBe(200);
		expect(server.config.DATA_DIR).toBe(dataDir);
		const upload = await fetch(`${server.url}/api/upload`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				filename: "middleware.png",
				data: Buffer.from("public-boundary").toString("base64"),
			}),
		});
		expect(upload.status).toBe(200);
		const printScript = await fetch(`${server.url}/print-autostart.js`);
		expect(printScript.status).toBe(200);
		const scriptPolicy = printScript.headers
			.get("content-security-policy")
			?.split(";")
			.find((directive) => directive.trim().startsWith("script-src"));
		expect(scriptPolicy).toContain("script-src 'self'");
		expect(scriptPolicy).not.toContain("'unsafe-inline'");

		await server.close();
		expect(server.closed).toBe(true);
		await server.close();
		await expect(fetch(server.url)).rejects.toThrow();
	});

	it("serves the shell, static assets and API both at the root and under its base path", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "maket-embedded-base-path-"));
		directories.push(dataDir);
		const config = createConfig({
			packageDir: resolve(import.meta.dirname, "../../.."),
			packaged: true,
			env: {
				MAKET_DATA_DIR: dataDir,
				MAKET_PORT: "0",
				MAKET_BIND_HOST: "127.0.0.1",
				MAKET_BASE_PATH: "/mobile/apps/maket",
			},
		});
		config.PUBLIC_DIR = join(dataDir, "public");
		mkdirSync(join(config.PUBLIC_DIR, "assets"), { recursive: true });
		writeFileSync(
			join(config.PUBLIC_DIR, "index.html"),
			'<!doctype html><html><head><script src="./assets/app.js"></script></head><body>{{TITLE}}</body></html>',
		);
		writeFileSync(join(config.PUBLIC_DIR, "assets", "app.js"), "// app");
		const server = await startMaketServer({
			config,
			bootstrap: { store: createSQLiteStore(":memory:"), browserPool },
			loadEnvironment: false,
			log: () => {},
		});

		try {
			for (const prefix of ["", "/mobile/apps/maket"]) {
				for (const path of [
					"/",
					"/documents/doc-123/read",
					"/assets/app.js",
					"/api/assets",
				]) {
					const response = await fetch(`${server.url}${prefix}${path}`);
					expect(response.status, `${prefix}${path}`).toBe(200);
				}
			}
			const shell = await fetch(`${server.url}/mobile/apps/maket`);
			expect(await shell.text()).toContain(
				'<base href="/mobile/apps/maket/" />',
			);
			const sibling = await fetch(
				`${server.url}/mobile/apps/maketx/assets/app.js`,
			);
			expect(sibling.status).toBe(404);
		} finally {
			await server.close();
		}
	});

	it("closes active HTTP connections instead of keeping Electron alive", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "maket-embedded-server-"));
		directories.push(dataDir);
		const packageDir = resolve(import.meta.dirname, "../../..");
		const config = createConfig({
			packageDir,
			packaged: true,
			env: {
				MAKET_DATA_DIR: dataDir,
				MAKET_PORT: "0",
				MAKET_BIND_HOST: "127.0.0.1",
			},
		});
		const server = await startMaketServer({
			config,
			bootstrap: { store: createSQLiteStore(":memory:"), browserPool },
			loadEnvironment: false,
			log: () => {},
		});
		const address = new URL(server.url);
		const socket = connect({
			host: address.hostname,
			port: Number(address.port),
		});
		await once(socket, "connect");
		const socketClosed = new Promise<void>((resolve) => {
			socket.on("error", () => {});
			socket.once("close", () => resolve());
		});
		socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n");

		await server.close();
		await socketClosed;
		expect(socket.destroyed).toBe(true);
	});

	it("keeps a DI disposal failure terminal across repeated close attempts", async () => {
		const dataDir = mkdtempSync(
			join(tmpdir(), "maket-embedded-dispose-failure-"),
		);
		directories.push(dataDir);
		const config = createConfig({
			packageDir: resolve(import.meta.dirname, "../../.."),
			packaged: true,
			env: {
				MAKET_DATA_DIR: dataDir,
				MAKET_PORT: "0",
				MAKET_BIND_HOST: "127.0.0.1",
			},
		});
		const server = await startMaketServer({
			config,
			bootstrap: { browserPool },
			loadEnvironment: false,
			log: () => {},
		});
		const realClose = DatabaseSync.prototype.close;
		const close = vi
			.spyOn(DatabaseSync.prototype, "close")
			.mockImplementation(function (this: DatabaseSync) {
				realClose.call(this);
				throw new Error("database disposer failed");
			});

		try {
			await expect(server.close()).rejects.toThrow("database disposer failed");
			expect(server.closed).toBe(false);
			await expect(server.close()).rejects.toThrow("database disposer failed");
			expect(server.closed).toBe(false);
			expect(close).toHaveBeenCalledOnce();
		} finally {
			close.mockRestore();
		}
	});

	it("rejects transport startup failures without leaving startup hanging", async () => {
		const dataDir = mkdtempSync(
			join(tmpdir(), "maket-embedded-server-failure-"),
		);
		directories.push(dataDir);
		const blocker = createServer();
		blocker.listen(0, "127.0.0.1");
		await once(blocker, "listening");
		const address = blocker.address();
		if (!address || typeof address === "string")
			throw new Error("Missing blocker address");
		const config = createConfig({
			packageDir: resolve(import.meta.dirname, "../../.."),
			packaged: true,
			env: {
				MAKET_DATA_DIR: dataDir,
				MAKET_PORT: String(address.port),
				MAKET_BIND_HOST: "127.0.0.1",
			},
		});
		const store = createSQLiteStore(":memory:");

		try {
			await expect(
				startMaketServer({
					config,
					bootstrap: { store, browserPool },
					loadEnvironment: false,
					log: () => {},
				}),
			).rejects.toThrow();
		} finally {
			store.close();
			blocker.closeAllConnections();
			await new Promise<void>((resolveClose) =>
				blocker.close(() => resolveClose()),
			);
		}
	});
});
