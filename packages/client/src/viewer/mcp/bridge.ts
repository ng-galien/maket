/**
 * The reader's side of MCP Apps (stable spec 2026-01-26): JSON-RPC over
 * postMessage with the host. The reader initializes, receives the tool input
 * and result that opened it, follows the host context, calls the app-only
 * tool `maket_reader` of its own server through the host, asks the host to
 * open links, and reports its size.
 */

export interface HostContext {
	theme?: "light" | "dark" | string;
	styles?: { variables?: Record<string, string | undefined> };
	containerDimensions?: {
		width?: number;
		height?: number;
		maxWidth?: number;
		maxHeight?: number;
	};
}

export interface ToolResult {
	content?: { type: string; text?: string }[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
}

export interface BridgeEvents {
	onToolInput?: (args: Record<string, unknown>) => void;
	onToolResult?: (result: ToolResult) => void;
	onHostContext?: (context: HostContext) => void;
}

export interface McpAppBridge {
	callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
	openLink(url: string): Promise<void>;
	reportSize(size: { width?: number; height: number }): void;
}

interface JsonRpcMessage {
	jsonrpc: "2.0";
	id?: number | string;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { message?: string };
}

/** Connect to the host: the handshake starts at once; events arrive as the
 * host sends them. */
export function connectMcpApp(events: BridgeEvents): McpAppBridge {
	const target = window.parent;
	let nextId = 1;
	let initialized = false;
	let lastSize: { width?: number; height: number } | null = null;
	const waiting = new Map<
		number | string,
		{ resolve: (value: unknown) => void; reject: (error: unknown) => void }
	>();
	const send = (message: JsonRpcMessage) => target.postMessage(message, "*");
	const request = (method: string, params: unknown) =>
		new Promise<unknown>((resolve, reject) => {
			const id = nextId++;
			waiting.set(id, { resolve, reject });
			send({ jsonrpc: "2.0", id, method, params });
		});
	const notify = (method: string, params: unknown) =>
		send({ jsonrpc: "2.0", method, params });

	window.addEventListener("message", (event) => {
		if (event.source !== target) return;
		const message = event.data as JsonRpcMessage | undefined;
		if (message?.jsonrpc !== "2.0") return;
		if (message.method === undefined && message.id !== undefined) {
			const waiter = waiting.get(message.id);
			if (!waiter) return;
			waiting.delete(message.id);
			if (message.error)
				waiter.reject(new Error(message.error.message ?? "Host error"));
			else waiter.resolve(message.result);
			return;
		}
		switch (message.method) {
			case "ui/notifications/tool-input":
				events.onToolInput?.(
					((message.params as { arguments?: Record<string, unknown> })
						?.arguments ?? {}) as Record<string, unknown>,
				);
				return;
			case "ui/notifications/tool-result":
				events.onToolResult?.(message.params as ToolResult);
				return;
			case "ui/notifications/host-context-changed":
				events.onHostContext?.(message.params as HostContext);
				return;
			case "ui/resource-teardown":
			case "ping":
				if (message.id !== undefined)
					send({ jsonrpc: "2.0", id: message.id, result: {} });
				return;
		}
	});

	request("ui/initialize", {
		appInfo: { name: "maket-reader", version: "1.0.0" },
		appCapabilities: { availableDisplayModes: ["inline"] },
		protocolVersion: "2026-01-26",
	})
		.then((result) => {
			const context = (result as { hostContext?: HostContext })?.hostContext;
			if (context) events.onHostContext?.(context);
		})
		.catch(() => {})
		.finally(() => {
			notify("ui/notifications/initialized", {});
			initialized = true;
			if (lastSize) notify("ui/notifications/size-changed", lastSize);
		});

	return {
		async callTool(name, args) {
			return (await request("tools/call", {
				name,
				arguments: args,
			})) as ToolResult;
		},
		async openLink(url) {
			await request("ui/open-link", { url });
		},
		reportSize(size) {
			if (lastSize?.height === size.height && lastSize?.width === size.width)
				return;
			lastSize = size;
			if (initialized) notify("ui/notifications/size-changed", size);
		},
	};
}
