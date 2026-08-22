import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
});
