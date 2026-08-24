import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || !address) {
        server.close();
        reject(new Error("Could not allocate a test port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Claude Desktop MCPB", () => {
  it("contains only a connect-only stdio bridge to Maket App", async () => {
    const root = mkdtempSync(join(tmpdir(), "maket-claude-desktop-mcpb-"));
    roots.push(root);
    const port = await pickFreePort();
    const output = join(root, "maket-app.mcpb");
    execFileSync(process.execPath, [
      resolve(import.meta.dirname, "../../../scripts/desktop.mjs"),
      "mcpb",
      "--output",
      output,
    ]);
    const secondOutput = join(root, "maket-app-second.mcpb");
    execFileSync(process.execPath, [
      resolve(import.meta.dirname, "../../../scripts/desktop.mjs"),
      "mcpb",
      "--output",
      secondOutput,
    ]);
    expect(readFileSync(secondOutput)).toEqual(readFileSync(output));

    const zip = await JSZip.loadAsync(readFileSync(output));
    expect(Object.keys(zip.files).sort()).toEqual(["icon.png", "index.mjs", "manifest.json", "package.json"]);
    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) throw new Error("MCPB manifest is missing");
    const manifest = JSON.parse(await manifestFile.async("string"));
    const rootPackage = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../package.json"), "utf8"));
    expect(manifest.version).toBe(rootPackage.version);
    expect(manifest.icon).toBe("icon.png");
    const iconFile = zip.file("icon.png");
    if (!iconFile) throw new Error("MCPB icon is missing");
    const icon = await iconFile.async("nodebuffer");
    expect(icon.subarray(1, 4).toString()).toBe("PNG");
    expect(icon.readUInt32BE(16)).toBe(1024);
    expect(icon.readUInt32BE(20)).toBe(1024);
    expect(manifest.server.mcp_config).toMatchObject({
      command: "node",
      env: { MAKET_CONNECT_ONLY: "1", MAKET_PORT: "24843" },
    });
    expect(zip.file("server.js")).toBeNull();

    const entry = join(root, "index.mjs");
    const entryFile = zip.file("index.mjs");
    if (!entryFile) throw new Error("MCPB bridge is missing");
    writeFileSync(entry, await entryFile.async("nodebuffer"));

    const upstream = createMcpHandler(() => {
      const server = new McpServer({ name: "maket-app", version: "1" }, { capabilities: { tools: {} } });
      server.registerTool("maket_document_create", { description: "A tool exposed by Maket App" }, async () => ({
        content: [{ type: "text", text: "attached" }],
      }));
      return server;
    });
    const upstreamHandler = toNodeHandler(upstream);
    const httpServer = createHttpServer((request, response) => {
      void upstreamHandler(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(port, "127.0.0.1", resolve);
    });

    const client = new Client({ name: "desktop-bundle-test", version: "1" }, { versionNegotiation: { mode: "auto" } });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [entry],
        stderr: "pipe",
        env: {
          ...getDefaultEnvironment(),
          MAKET_CONNECT_ONLY: "1",
          MAKET_PORT: String(port),
          MAKET_DATA_DIR: join(root, "data"),
        },
      }),
      { timeout: 3_000 },
    );
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(["maket_app_status", "maket_document_create"]);
      const status = await client.callTool({
        name: "maket_app_status",
        arguments: {},
      });
      expect(status).toMatchObject({
        content: [
          {
            type: "text",
            text: "Maket App is open and ready.",
          },
        ],
      });
      const result = await client.callTool({ name: "maket_document_create", arguments: {} });
      expect(result.content).toEqual([{ type: "text", text: "attached" }]);
    } finally {
      await client.close();
      await upstream.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }, 15_000);
});
