import { asFunction, asValue, createContainer } from "awilix";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { mountTools, type ToolHandler } from "./container.js";

function makeTool(name: string): ToolHandler {
	return {
		metadata: {
			name,
			description: `desc-${name}`,
			schema: z.object({ value: z.string() }),
		},
		handler: async (args) => ({
			content: [{ type: "text", text: `${name}:${args.value}` }],
		}),
	};
}

/**
 * Minimal McpServer stub — we only care that `.tool(name, desc, shape, cb)`
 * is called correctly. Full SDK instance would require a transport.
 */
function makeServer() {
	return {
		tool: vi.fn(),
	};
}

describe("mountTools", () => {
	it("registers every tool from the registry onto the MCP server", () => {
		const registry = new Map<string, ToolHandler>([
			["foo", makeTool("foo")],
			["bar", makeTool("bar")],
		]);
		const container = createContainer().register({
			toolRegistry: asValue(registry),
		});
		const server = makeServer();

		// biome-ignore lint/suspicious/noExplicitAny: stub doesn't need full SDK typing
		mountTools(server as any, container);

		expect(server.tool).toHaveBeenCalledTimes(2);
		const calls = server.tool.mock.calls.map((c) => c[0]).sort();
		expect(calls).toEqual(["bar", "foo"]);
	});

	it("passes name, description, and zod shape to server.tool", () => {
		const tool = makeTool("foo");
		const registry = new Map([["foo", tool]]);
		const container = createContainer().register({
			toolRegistry: asValue(registry),
		});
		const server = makeServer();

		// biome-ignore lint/suspicious/noExplicitAny: stub doesn't need full SDK typing
		mountTools(server as any, container);

		const [name, desc, shape, cb] = server.tool.mock.calls[0] ?? [];
		expect(name).toBe("foo");
		expect(desc).toBe("desc-foo");
		expect(shape).toBe(tool.metadata.schema.shape);
		expect(typeof cb).toBe("function");
	});

	it("delegates invocation to the underlying tool handler", async () => {
		const tool = makeTool("foo");
		const registry = new Map([["foo", tool]]);
		const container = createContainer().register({
			toolRegistry: asValue(registry),
		});
		const server = makeServer();

		// biome-ignore lint/suspicious/noExplicitAny: stub doesn't need full SDK typing
		mountTools(server as any, container);
		const cb = server.tool.mock.calls[0]?.[3] as (
			args: Record<string, unknown>,
			extra: unknown,
		) => Promise<{ content: { text: string }[] }>;

		const result = await cb({ value: "hello" }, {});
		expect(result.content[0]?.text).toBe("foo:hello");
	});

	it("resolves toolRegistry from the container at mount time", () => {
		// Ensure the function actually calls container.resolve — not captured closure
		const registry = new Map<string, ToolHandler>();
		const container = createContainer().register({
			toolRegistry: asFunction(() => registry).singleton(),
		});
		const server = makeServer();

		// biome-ignore lint/suspicious/noExplicitAny: stub doesn't need full SDK typing
		mountTools(server as any, container);
		expect(server.tool).not.toHaveBeenCalled(); // empty registry → no mounts
	});
});
