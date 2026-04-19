/**
 * tool-pack-registry.ts — Build an Awilix DI container from explicit tool packs.
 *
 * Each ToolPack declares `requires` and `capabilities`. After registration,
 * every Awilix registration whose name ends with `Tool` is scanned, validated
 * as a ToolHandler, and collected into a `toolRegistry` Map (used by mountTools).
 */

import { type AwilixContainer, asValue, createContainer } from "awilix";
import type { ToolHandler } from "./container.js";
import type { ToolPack, ToolPackConfig } from "./tool-pack.js";

export interface ToolPackManifest {
	/** ToolPack id → config. Order determines registration order. */
	packs: Record<string, ToolPackConfig>;
}

export interface ToolPackContainerResult {
	container: AwilixContainer;
	loadedPacks: string[];
}

export interface RegisterToolPacksResult {
	loadedPacks: string[];
	toolRegistry: Map<string, ToolHandler>;
}

/**
 * Register tool packs into an existing container. Reuses the container's
 * service graph so packs see the same `bus`, `store`, `documents`, etc. as
 * the rest of the app.
 */
export function registerToolPacks(
	container: AwilixContainer,
	manifest: ToolPackManifest,
	available: ToolPack[],
): RegisterToolPacksResult {
	const loadedPacks: string[] = [];
	const capabilities = container.hasRegistration("packCapabilities")
		? container.resolve<Set<string>>("packCapabilities")
		: new Set<string>();
	if (!container.hasRegistration("packCapabilities")) {
		container.register({ packCapabilities: asValue(capabilities) });
	}

	const byId = new Map<string, ToolPack>();
	for (const pack of available) {
		if (byId.has(pack.id))
			throw new Error(`Duplicate tool pack id: ${pack.id}`);
		byId.set(pack.id, pack);
	}

	for (const [id, config] of Object.entries(manifest.packs)) {
		const pack = byId.get(id);
		if (!pack) throw new Error(`Unknown tool pack: ${id}`);

		if (pack.requires) {
			for (const dep of pack.requires) {
				if (!container.registrations[dep]) {
					throw new Error(
						`Tool pack "${id}" requires "${dep}" but it is not registered. Check pack load order.`,
					);
				}
			}
		}

		if (pack.capabilities) {
			for (const cap of pack.capabilities) capabilities.add(cap);
		}

		pack.register(container, config);
		loadedPacks.push(id);
	}

	const toolRegistry = new Map<string, ToolHandler>();
	for (const name of Object.keys(container.registrations)) {
		if (!name.endsWith("Tool")) continue;
		const val = container.resolve(name);
		if (isToolHandler(val)) {
			toolRegistry.set(val.metadata.name, val);
		}
	}
	if (container.hasRegistration("toolRegistry")) {
		// Replace in-place so existing resolutions pick up new tools.
		const existing =
			container.resolve<Map<string, ToolHandler>>("toolRegistry");
		existing.clear();
		for (const [k, v] of toolRegistry) existing.set(k, v);
	} else {
		container.register({ toolRegistry: asValue(toolRegistry) });
	}

	return { loadedPacks, toolRegistry };
}

/**
 * Build a fresh container and register tool packs into it. Used by tests and
 * as a convenience entry point when no pre-existing container is available.
 */
export function buildToolPackContainer(
	manifest: ToolPackManifest,
	available: ToolPack[],
): ToolPackContainerResult {
	const container = createContainer({ strict: true });
	const { loadedPacks } = registerToolPacks(container, manifest, available);
	return { container, loadedPacks };
}

function isToolHandler(val: unknown): val is ToolHandler {
	if (typeof val !== "object" || val === null) return false;
	const candidate = val as Record<string, unknown>;
	const meta = candidate.metadata;
	return (
		typeof meta === "object" &&
		meta !== null &&
		typeof (meta as Record<string, unknown>).name === "string" &&
		typeof candidate.handler === "function"
	);
}
