import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRuntimeDescriptor, runtimeDescriptorPath } from "@maket/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	publishRuntimeOwnership,
	readPackageVersion,
} from "./runtime-ownership.js";

let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "maket-runtime-"));
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
});

function publish(
	overrides: Partial<Parameters<typeof publishRuntimeOwnership>[0]> = {},
) {
	return publishRuntimeOwnership({
		dataDir,
		host: "127.0.0.1",
		port: 24842,
		version: "2.0.0",
		...overrides,
	});
}

describe("publishRuntimeOwnership", () => {
	it("publishes a headless descriptor other runtimes can read", () => {
		const ownership = publish();
		expect(ownership.owned).toBe(true);
		const descriptor = readRuntimeDescriptor(dataDir);
		expect(descriptor).toMatchObject({
			owner: "headless",
			pid: process.pid,
			host: "127.0.0.1",
			port: 24842,
			dataDir,
			version: "2.0.0",
		});
	});

	it("removes the descriptor on release and tolerates a second call", () => {
		const ownership = publish();
		ownership.release();
		ownership.release();
		expect(readRuntimeDescriptor(dataDir)).toBeNull();
	});

	it("keeps a live owner's descriptor and warns instead of stealing it", () => {
		publish({ pid: process.pid, instanceId: "owner-1" });
		const log = vi.fn();
		const second = publishRuntimeOwnership({
			dataDir,
			host: "127.0.0.1",
			port: 24843,
			version: "2.0.0",
			pid: process.pid + 1,
			log,
		});
		expect(second.owned).toBe(false);
		expect(log.mock.calls[0]?.[0]).toContain("already owns");
		expect(readRuntimeDescriptor(dataDir)?.port).toBe(24842);
	});

	it("takes over a descriptor left behind by a dead process", () => {
		writeFileSync(
			runtimeDescriptorPath(dataDir),
			JSON.stringify({
				schemaVersion: 1,
				owner: "headless",
				pid: 2 ** 30,
				host: "127.0.0.1",
				port: 24842,
				dataDir,
				version: "1.0.0",
				instanceId: "dead",
				startedAt: new Date().toISOString(),
			}),
		);
		expect(publish().owned).toBe(true);
		expect(readRuntimeDescriptor(dataDir)?.version).toBe("2.0.0");
	});

	it("does not release a descriptor another instance republished", () => {
		const first = publish({ instanceId: "first" });
		publish({ instanceId: "second" });
		first.release();
		expect(readRuntimeDescriptor(dataDir)?.instanceId).toBe("second");
	});
});

describe("readPackageVersion", () => {
	it("reads the version next to the package root", () => {
		writeFileSync(
			join(dataDir, "package.json"),
			JSON.stringify({ version: "9.9.9" }),
		);
		expect(readPackageVersion(dataDir)).toBe("9.9.9");
	});

	it("falls back when there is no readable manifest", () => {
		expect(readPackageVersion(dataDir)).toBe("unknown");
		writeFileSync(join(dataDir, "package.json"), "{ not json");
		expect(readPackageVersion(dataDir)).toBe("unknown");
	});
});
