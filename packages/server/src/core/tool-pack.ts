/**
 * plugin.ts — Explicit plugin contract for mcp-maket.
 *
 * A plugin is a plain object that declares what it brings (services, tools)
 * and what it needs (requires). No abstract class, no framework.
 */

import type { AwilixContainer } from "awilix";

export type ToolPackConfig = Record<string, unknown>;

export interface ToolPack {
	/** Unique identifier, kebab-case. E.g. "documents", "gmail". */
	readonly id: string;

	/** Human-readable name for logs and diagnostics. */
	readonly name: string;

	/**
	 * Awilix registration names this plugin requires before it runs.
	 * Checked at load time — missing dependency = hard error.
	 */
	readonly requires?: string[];

	/**
	 * Capability tokens this plugin provides.
	 * Used for optional cross-plugin detection (e.g. pdf plugin checking for "gmail").
	 */
	readonly capabilities?: string[];

	/** Register services and tools into the DI container. */
	register(container: AwilixContainer, config: ToolPackConfig): void;
}
