import {
	Client,
	StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";

const MCP_URL = new URL("http://localhost:3399/mcp");

export class McpTestClient {
	private constructor(private readonly client: Client) {}

	static async connect(): Promise<McpTestClient> {
		const client = new Client(
			{ name: "maket-playwright", version: "1.0.0" },
			{ versionNegotiation: { mode: "auto" } },
		);
		await client.connect(new StreamableHTTPClientTransport(MCP_URL));
		return new McpTestClient(client);
	}

	async call(
		name: string,
		args: Record<string, unknown>,
	): Promise<CallToolResult> {
		const result = (await this.client.callTool({
			name,
			arguments: args,
		})) as CallToolResult;
		if (result.isError) {
			throw new Error(`${name} failed: ${resultText(result)}`);
		}
		return result;
	}

	async callJson<T>(name: string, args: Record<string, unknown>): Promise<T> {
		return JSON.parse(resultText(await this.call(name, args))) as T;
	}

	async close(): Promise<void> {
		await this.client.close();
	}
}

function resultText(result: CallToolResult): string {
	const content = result.content[0];
	if (content?.type !== "text") throw new Error("Expected an MCP text result");
	return content.text;
}
