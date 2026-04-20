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
	 * MCP tool names this pack must produce. Verified post-registration:
	 * if any declared tool is missing from the resolved registry (e.g. a
	 * typo like `maketDocTol` that skipped the `endsWith("Tool")` scan),
	 * boot fails fast.
	 */
	readonly declaresTools: string[];

	/** Register services and tools into the DI container. */
	register(container: AwilixContainer, config: ToolPackConfig): void;
}
