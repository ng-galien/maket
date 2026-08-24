import type { Client, Tool } from "@modelcontextprotocol/client";
import {
	fromJsonSchema,
	type JsonSchemaType,
	type McpServer,
	type RegisteredTool,
} from "@modelcontextprotocol/server";

export const MCP_DISCOVERY_TIMEOUT_MS = 3_000;

export async function listAllTools(client: Client): Promise<Tool[]> {
	const tools: Tool[] = [];
	let cursor: string | undefined;
	do {
		const page = await client.listTools(cursor ? { cursor } : undefined, {
			timeout: MCP_DISCOVERY_TIMEOUT_MS,
		});
		tools.push(...page.tools);
		cursor = page.nextCursor;
	} while (cursor !== undefined);
	return tools;
}

export function registerProxyTools(
	server: McpServer,
	tools: Tool[],
	getClient: () => Client | undefined,
): RegisteredTool[] {
	return tools.map((tool) =>
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: fromJsonSchema<Record<string, unknown>>(
					tool.inputSchema as JsonSchemaType,
				),
				...(tool.outputSchema
					? {
							outputSchema: fromJsonSchema(tool.outputSchema as JsonSchemaType),
						}
					: {}),
				annotations: tool.annotations,
				icons: tool.icons,
				_meta: tool._meta,
			},
			async (args, ctx) => {
				const client = getClient();
				if (!client) {
					throw new Error("Maket App is not open. Open the app and try again.");
				}
				return client.callTool(
					{ name: tool.name, arguments: args },
					{ signal: ctx.mcpReq.signal },
				);
			},
		),
	);
}

export function waitForStdioClose(close: () => Promise<void>): Promise<void> {
	return new Promise((resolve, reject) => {
		let stopping = false;
		const stop = () => {
			if (stopping) return;
			stopping = true;
			process.off("SIGINT", stop);
			process.off("SIGTERM", stop);
			process.stdin.off("close", stop);
			process.stdin.off("end", stop);
			close().then(resolve, reject);
		};

		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
		process.stdin.once("close", stop);
		process.stdin.once("end", stop);
	});
}
