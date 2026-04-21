import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	lastOnCall: null as
		| null
		| ((name: string, args: Record<string, unknown>) => void),
	transportShouldThrow: false,
	serverInstances: [] as Array<{
		connect: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
		tool: ReturnType<typeof vi.fn>;
	}>,
	transportInstances: [] as Array<{
		close: ReturnType<typeof vi.fn>;
		handleRequest: ReturnType<typeof vi.fn>;
	}>,
	mountCalls: [] as Array<{
		server: unknown;
		container: unknown;
	}>,
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
	McpServer: class {
		connect = vi.fn(async () => {});
		close = vi.fn(async () => {});
		tool = vi.fn();

		constructor() {
			mockState.serverInstances.push(this);
		}
	},
}));

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
	StreamableHTTPServerTransport: class {
		close = vi.fn(async () => {});
		handleRequest = vi.fn(async (_req, res, body) => {
			if (mockState.transportShouldThrow) throw new Error("transport failed");
			mockState.lastOnCall?.("maket_html", {
				action: "set",
				doc: "poster",
				html: '<div data-id="a"></div><div data-id="b"></div>',
			});
			res.status(200).json({ ok: true, body });
		});

		constructor() {
			mockState.transportInstances.push(this);
		}
	},
}));

vi.mock("../core/container.js", () => ({
	mountTools: vi.fn(
		(
			server: unknown,
			container: unknown,
			onCall?: (name: string, args: Record<string, unknown>) => void,
		) => {
			mockState.lastOnCall = onCall ?? null;
			mockState.mountCalls.push({ server, container });
		},
	),
}));

import { startTestApp } from "../../tests/helpers.js";
import { createMcpRouter } from "./mcp.routes.js";

describe("mcp routes", () => {
	let baseUrl: string;
	let close: () => Promise<void>;
	let wsRegistry: { broadcast: ReturnType<typeof vi.fn> };
	const container = { tag: "container" } as any;

	beforeEach(async () => {
		mockState.lastOnCall = null;
		mockState.transportShouldThrow = false;
		mockState.serverInstances.length = 0;
		mockState.transportInstances.length = 0;
		mockState.mountCalls.length = 0;
		wsRegistry = { broadcast: vi.fn() };

		const app = express();
		app.use(express.json());
		app.use(createMcpRouter({ container, wsRegistry: wsRegistry as any }));
		({ baseUrl, close } = await startTestApp(app));
	});

	afterEach(async () => {
		await close();
	});

	it("POST /mcp handles the request and broadcasts the activity bubble payload", async () => {
		const res = await fetch(`${baseUrl}/mcp`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call" }),
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			ok: true,
			body: { jsonrpc: "2.0", id: 1, method: "tools/call" },
		});
		expect(mockState.mountCalls).toHaveLength(1);
		expect(mockState.mountCalls[0]?.container).toBe(container);
		expect(wsRegistry.broadcast).toHaveBeenCalledWith({
			type: "activity",
			key: "bubble_maket_html_set",
			params: { name: "poster", count: "2" },
			icon: "file-pen",
		});
		expect(
			mockState.transportInstances[0]?.handleRequest,
		).toHaveBeenCalledOnce();
		expect(mockState.transportInstances[0]?.close).toHaveBeenCalledOnce();
		expect(mockState.serverInstances[0]?.connect).toHaveBeenCalledOnce();
		expect(mockState.serverInstances[0]?.close).toHaveBeenCalledOnce();
	});

	it("returns a JSON-RPC 500 payload when the transport throws", async () => {
		mockState.transportShouldThrow = true;

		const res = await fetch(`${baseUrl}/mcp`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call" }),
		});

		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({
			jsonrpc: "2.0",
			error: { code: -32603, message: "transport failed" },
			id: null,
		});
		expect(wsRegistry.broadcast).not.toHaveBeenCalled();
		expect(mockState.transportInstances[0]?.close).toHaveBeenCalledOnce();
		expect(mockState.serverInstances[0]?.close).toHaveBeenCalledOnce();
	});
});
