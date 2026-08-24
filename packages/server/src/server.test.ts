import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startMaketServer } from "./server.js";
import { createConfig } from "./services/config.js";
import { createSQLiteStore } from "./services/store.js";

const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("embedded Maket server", () => {
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
		const store = createSQLiteStore(":memory:");
		const server = await startMaketServer({
			config,
			bootstrap: { store },
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
			bootstrap: { store: createSQLiteStore(":memory:") },
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
					bootstrap: { store },
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
