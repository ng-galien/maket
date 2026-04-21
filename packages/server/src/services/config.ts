/**
 * config — resolved paths and constants for the server.
 *
 * Pure factory: reads env + homedir from injected dependencies so tests can
 * drive it without touching `process.env`. `ensureDirs()` is a separate
 * side-effecting helper so the factory itself is pure.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
	/** Detect compiled binary mode — false in Node.js mode. */
	COMPILED: boolean;
	/** Running from an extracted mcpb bundle (no `packages/` tree present). */
	PACKAGED: boolean;
	/** Directory where public/ and package assets live. */
	PACKAGE_DIR: string;
	/** User data root (writable, persists). */
	DATA_DIR: string;
	/** Read-only public/ assets directory. */
	PUBLIC_DIR: string;
	/** Writable user-asset directory. */
	ASSETS_DIR: string;
	/** Writable documents directory (exported files). */
	DOCS_DIR: string;
	/** Writable exports directory. */
	EXPORTS_DIR: string;
	/** SQLite database path. */
	DB_PATH: string;
	/** HTTP/WS port. */
	PORT: number;
	/** HTTP/WS bind address. Defaults to 127.0.0.1; set MAKET_BIND_HOST=0.0.0.0
	 *  only if you intentionally want to expose Maket on the LAN. */
	HOST: string;
	/** Application name shown in UI. */
	APP_TITLE: string;
	/** Application subtitle shown in UI (may be empty). */
	APP_SUBTITLE: string;
}

export interface ConfigInputs {
	env?: Record<string, string | undefined>;
	homedir?: () => string;
}

const DEFAULT_PORT = 24842;

export function createConfig(inputs: ConfigInputs = {}): Config {
	const env = inputs.env ?? process.env;
	const homedir = inputs.homedir ?? osHomedir;

	const __dirname = dirname(fileURLToPath(import.meta.url));
	const projectRoot = resolve(__dirname, "../../../..");
	const COMPILED = false;
	const PACKAGED = !COMPILED && !existsSync(join(projectRoot, "packages"));

	const PACKAGE_DIR = COMPILED
		? dirname(process.execPath)
		: PACKAGED
			? __dirname
			: projectRoot;

	const explicitData = env.MAKET_DATA_DIR;
	const DATA_DIR = explicitData ? explicitData : join(homedir(), ".maket");

	const PUBLIC_DIR = join(PACKAGE_DIR, "public");
	const ASSETS_DIR = join(DATA_DIR, "assets");
	const DOCS_DIR = join(DATA_DIR, "documents");
	const EXPORTS_DIR = join(DATA_DIR, "exports");
	const DB_PATH = env.MAKET_DB || join(DATA_DIR, "documents.db");

	const portRaw = env.MAKET_PORT;
	const PORT = portRaw ? Number(portRaw) : DEFAULT_PORT;
	const HOST = env.MAKET_BIND_HOST || "127.0.0.1";

	const APP_TITLE = env.MAKET_TITLE || "Maket";
	const APP_SUBTITLE = env.MAKET_SUBTITLE || "";

	return {
		COMPILED,
		PACKAGED,
		PACKAGE_DIR,
		DATA_DIR,
		PUBLIC_DIR,
		ASSETS_DIR,
		DOCS_DIR,
		EXPORTS_DIR,
		DB_PATH,
		PORT,
		HOST,
		APP_TITLE,
		APP_SUBTITLE,
	};
}

/** Create writable directories on disk. Safe to call multiple times. */
export function ensureDirs(cfg: Config): void {
	for (const d of [cfg.ASSETS_DIR, cfg.DOCS_DIR, cfg.EXPORTS_DIR]) {
		if (!existsSync(d)) mkdirSync(d, { recursive: true });
	}
}

/** Load .env file from the project root if present (Node 22+ built-in). */
export function loadEnvFile(projectRoot?: string): void {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const root = projectRoot ?? resolve(__dirname, "../../../..");
	const envPath = join(root, ".env");
	if (existsSync(envPath)) {
		try {
			process.loadEnvFile(envPath);
		} catch {}
	}
}
