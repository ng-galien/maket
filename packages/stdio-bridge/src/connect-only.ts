import {
	Client,
	StreamableHTTPClientTransport,
	type Tool,
} from "@modelcontextprotocol/client";
import { McpServer, type RegisteredTool } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { readVersion } from "./commands/_version.ts";
import { probeServer } from "./probe.ts";
import {
	listAllTools,
	registerProxyTools,
	waitForStdioClose,
} from "./proxy-tools.ts";

type DownstreamServer = {
	server: McpServer;
	proxiedTools: RegisteredTool[];
};

type ConnectOnlyState = {
	client?: Client;
	tools: Tool[];
	servers: Set<DownstreamServer>;
};

function createWaitingServer(state: ConnectOnlyState): McpServer {
	const server = new McpServer(
		{ name: "maket", version: readVersion() },
		{ capabilities: { tools: { listChanged: true } } },
	);
	server.registerTool(
		"maket_app_status",
		{
			title: "Maket App status",
			description:
				"Check whether Maket App is open and ready for visual document work.",
		},
		async () => ({
			content: [
				{
					type: "text",
					text: state.client
						? "Maket App is open and ready."
						: "Maket App is not open. Open Maket App; this connector will attach automatically. You do not need to reinstall it or restart Claude.",
				},
			],
		}),
	);

	const downstream: DownstreamServer = { server, proxiedTools: [] };
	state.servers.add(downstream);
	downstream.proxiedTools = registerProxyTools(
		server,
		state.tools,
		() => state.client,
	);
	return server;
}

function refreshDownstreamServers(state: ConnectOnlyState): void {
	for (const downstream of state.servers) {
		for (const tool of downstream.proxiedTools) tool.remove();
		downstream.proxiedTools = registerProxyTools(
			downstream.server,
			state.tools,
			() => state.client,
		);
		if (downstream.server.isConnected())
			downstream.server.sendToolListChanged();
	}
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

async function monitorMaketApp(
	state: ConnectOnlyState,
	port: number,
	host: string,
	log: (message: string) => void,
	signal: AbortSignal,
): Promise<void> {
	let waitingLogged = false;
	while (!signal.aborted) {
		if (state.client && !(await probeServer(port, host, 500))) {
			await state.client.close().catch(() => {});
			state.client = undefined;
			state.tools = [];
			refreshDownstreamServers(state);
			waitingLogged = false;
		}

		if (!state.client) {
			if (await connectMaketApp(state, port, host, log, signal, true))
				waitingLogged = false;
			if (!state.client && !waitingLogged) {
				log("Maket App is not open; connector ready and waiting");
				waitingLogged = true;
			}
		}
		await delay(1_000, signal);
	}
	await state.client?.close().catch(() => {});
}

async function connectMaketApp(
	state: ConnectOnlyState,
	port: number,
	host: string,
	log: (message: string) => void,
	signal: AbortSignal,
	refreshServers: boolean,
): Promise<boolean> {
	if (!(await probeServer(port, host, 500))) return false;

	const candidate = new Client(
		{ name: "maket-stdio-gateway", version: readVersion() },
		{ versionNegotiation: { mode: "auto" } },
	);
	try {
		await candidate.connect(
			new StreamableHTTPClientTransport(new URL(`http://${host}:${port}/mcp`)),
			{ signal, timeout: 3_000 },
		);
		state.tools = await listAllTools(candidate);
		state.client = candidate;
		if (refreshServers) refreshDownstreamServers(state);
		log(`Maket App connected; exposing ${state.tools.length} tools over stdio`);
		return true;
	} catch {
		await candidate.close().catch(() => {});
		return false;
	}
}

export async function runConnectOnlyBridge(
	port: number,
	host: string,
	log: (message: string) => void,
): Promise<void> {
	const state: ConnectOnlyState = { tools: [], servers: new Set() };
	const stop = new AbortController();
	await connectMaketApp(state, port, host, log, stop.signal, false);
	const monitor = monitorMaketApp(state, port, host, log, stop.signal);
	const handle = serveStdio(() => createWaitingServer(state), {
		onerror: (error) => log(`stdio: ${error.stack ?? error.message}`),
	});
	await waitForStdioClose(async () => {
		stop.abort();
		await handle.close();
	});
	await monitor;
	log("stdio closed; exiting");
}
