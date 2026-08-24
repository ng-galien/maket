/**
 * runtime-ownership — publish the `runtime.json` descriptor for a headless
 * server so other Maket runtimes can see who owns a workspace.
 *
 * Without this the desktop application cannot tell that a CLI/npm server is
 * already serving `~/.maket`, starts its own server on another port, and two
 * processes end up writing the same SQLite workspace from separate in-memory
 * caches.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	isProcessAlive,
	readRuntimeDescriptor,
	removeRuntimeDescriptor,
	writeRuntimeDescriptor,
} from "@maket/runtime";

export interface RuntimeOwnership {
	/** True when this process published the descriptor. */
	readonly owned: boolean;
	/** Drop the descriptor again; safe to call more than once. */
	release(): void;
}

export interface RuntimeOwnershipInputs {
	dataDir: string;
	host: string;
	port: number;
	version: string;
	pid?: number;
	instanceId?: string;
	startedAt?: string;
	log?: (message: string) => void;
}

const RELEASED: RuntimeOwnership = { owned: false, release: () => {} };

export function readPackageVersion(packageDir: string): string {
	try {
		const pkg: unknown = JSON.parse(
			readFileSync(join(packageDir, "package.json"), "utf-8"),
		);
		const version = (pkg as { version?: unknown } | null)?.version;
		return typeof version === "string" ? version : "unknown";
	} catch {
		return "unknown";
	}
}

export function publishRuntimeOwnership(
	inputs: RuntimeOwnershipInputs,
): RuntimeOwnership {
	const log =
		inputs.log ?? ((message: string) => process.stderr.write(message));
	const pid = inputs.pid ?? process.pid;
	const existing = readRuntimeDescriptor(inputs.dataDir);
	if (existing && existing.pid !== pid && isProcessAlive(existing.pid)) {
		log(
			`[runtime] WARNING: Maket ${existing.owner} runtime (pid ${existing.pid}) already owns ${inputs.dataDir} on ${existing.host}:${existing.port}. Two servers sharing one workspace can overwrite each other's documents.\n`,
		);
		return RELEASED;
	}
	const instanceId = inputs.instanceId ?? randomUUID();
	try {
		writeRuntimeDescriptor({
			schemaVersion: 1,
			owner: "headless",
			pid,
			host: inputs.host,
			port: inputs.port,
			dataDir: inputs.dataDir,
			version: inputs.version,
			instanceId,
			startedAt: inputs.startedAt ?? new Date().toISOString(),
		});
	} catch (error) {
		log(
			`[runtime] could not publish workspace ownership: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		return RELEASED;
	}
	let released = false;
	return {
		owned: true,
		release() {
			if (released) return;
			released = true;
			try {
				removeRuntimeDescriptor(inputs.dataDir, instanceId);
			} catch {}
		},
	};
}
