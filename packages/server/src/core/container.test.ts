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
 * Minimal McpServer stub — full SDK behavior is covered at the HTTP boundary.
 */
function makeServer() {
	return {
		registerTool: vi.fn(),
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

		mountTools(server as any, container);

		expect(server.registerTool).toHaveBeenCalledTimes(2);
		const calls = server.registerTool.mock.calls.map((c) => c[0]).sort();
		expect(calls).toEqual(["bar", "foo"]);
	});

	it("passes name, description, and zod schema to registerTool", () => {
		const tool = makeTool("foo");
		const registry = new Map([["foo", tool]]);
		const container = createContainer().register({
			toolRegistry: asValue(registry),
		});
		const server = makeServer();

		mountTools(server as any, container);

		const [name, config, cb] = server.registerTool.mock.calls[0] ?? [];
		expect(name).toBe("foo");
		expect(config).toEqual({
			description: "desc-foo",
			inputSchema: tool.metadata.schema,
		});
		expect(typeof cb).toBe("function");
	});

	it("delegates invocation to the underlying tool handler", async () => {
		const tool = makeTool("foo");
		const registry = new Map([["foo", tool]]);
		const container = createContainer().register({
			toolRegistry: asValue(registry),
		});
		const server = makeServer();

		mountTools(server as any, container);
		const cb = server.registerTool.mock.calls[0]?.[2] as (
			args: Record<string, unknown>,
			extra: unknown,
		) => Promise<{ content: { text: string }[] }>;

		const result = await cb({ value: "hello" }, {});
		expect(result.content[0]?.text).toBe("foo:hello");
	});

	it("passes the completed result to the call observer", async () => {
		const tool = makeTool("foo");
		const registry = new Map([["foo", tool]]);
		const container = createContainer().register({
			toolRegistry: asValue(registry),
		});
		const server = makeServer();
		const onCall = vi.fn();

		mountTools(server as any, container, onCall);
		const cb = server.registerTool.mock.calls[0]?.[2] as (
			args: Record<string, unknown>,
			extra: unknown,
		) => Promise<unknown>;
		const result = await cb({ value: "hello" }, {});

		expect(onCall).toHaveBeenCalledWith("foo", { value: "hello" }, result);
	});

	it("propagates observer failures so contract drift stays observable", async () => {
		const tool = makeTool("foo");
		const registry = new Map([["foo", tool]]);
		const container = createContainer().register({
			toolRegistry: asValue(registry),
		});
		const server = makeServer();

		mountTools(server as any, container, () => {
			throw new Error("activity contract drift");
		});
		const cb = server.registerTool.mock.calls[0]?.[2] as (
			args: Record<string, unknown>,
			extra: unknown,
		) => Promise<unknown>;

		await expect(cb({ value: "hello" }, {})).rejects.toThrow(
			"activity contract drift",
		);
	});

	it("resolves toolRegistry from the container at mount time", () => {
		// Ensure the function actually calls container.resolve — not captured closure
		const registry = new Map<string, ToolHandler>();
		const container = createContainer().register({
			toolRegistry: asFunction(() => registry).singleton(),
		});
		const server = makeServer();

		mountTools(server as any, container);
		expect(server.registerTool).not.toHaveBeenCalled(); // empty registry → no mounts
	});
});
