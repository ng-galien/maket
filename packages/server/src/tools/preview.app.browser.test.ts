import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import {
	type CallToolResult,
	InMemoryTransport,
	McpServer,
} from "@modelcontextprotocol/server";
import { asValue } from "awilix";
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppContainer } from "../bootstrap.js";
import { mountAppViews, mountTools } from "../core/container.js";
import {
	CHROMIUM_HEADLESS,
	shouldDisableSandbox,
} from "../lib/chromium-sandbox.js";
import { createBrowserPool } from "../services/browser-pool.js";
import { createConfig } from "../services/config.js";
import type { Documents } from "../services/documents.js";
import type { McpAppViews } from "../services/mcp-app-views.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketPreviewTool } from "./preview.js";

let browser: Browser | undefined;
let tmp: string;

beforeAll(async () => {
	tmp = mkdtempSync(join(tmpdir(), "maket-app-view-"));
	browser = await puppeteer.launch({
		headless: CHROMIUM_HEADLESS,
		args: shouldDisableSandbox() ? ["--no-sandbox"] : [],
	});
}, 30_000);

afterAll(async () => {
	await browser?.close();
	rmSync(tmp, { recursive: true, force: true });
}, 30_000);

/** A Maket server with maket_preview and the MCP Apps views, reached by a
 * host client over an in-memory transport. */
async function maketHost() {
	const store = createSQLiteStore(":memory:");
	const container = createAppContainer({
		browserPool: createBrowserPool(
			{},
			{
				launch: async () => {
					if (!browser) throw new Error("Chromium did not start");
					return browser;
				},
			},
		),
		ensure: true,
		store,
		config: createConfig({
			env: { MAKET_DATA_DIR: tmp },
			homedir: () => "/nowhere",
		}),
	});
	container.resolve<Documents>("documents").loadAll();
	container.register({
		toolRegistry: asValue(
			new Map([
				["maket_preview", createMaketPreviewTool(container.cradle as never)],
			]),
		),
	});
	const server = new McpServer(
		{ name: "maket", version: "test" },
		{ capabilities: { tools: {}, resources: {} } },
	);
	mountTools(server, container);
	mountAppViews(server, container.resolve<McpAppViews>("mcpAppViews"));
	const [hostSide, serverSide] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "harness-host", version: "1" });
	await server.connect(serverSide);
	await client.connect(hostSide);
	return {
		store,
		client,
		documents: container.resolve<Documents>("documents"),
	};
}

/** The CSP a host builds for ui://maket/page from the spec defaults and the
 * resource's declared font hosts (no connectDomains, no frameDomains). */
const VIEW_CSP = [
	"default-src 'none'",
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com https://fonts.bunny.net",
	"img-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com https://fonts.bunny.net",
	"font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com https://fonts.bunny.net",
	"media-src 'self' data:",
	"connect-src 'none'",
	"frame-src 'none'",
	"base-uri 'self'",
	"object-src 'none'",
].join("; ");

/** The five links of review 1548c072, each posting to the top window when
 * its script runs. */
const VECTORS = [
	'<a id="v-tab" href="java&#x09;script:top.postMessage({pwned:\'tab\'},\'*\')" style="display:block;width:300px;height:40px;background:#fde68a">tab</a>',
	'<a id="v-nl" href="java&#x0A;script:top.postMessage({pwned:\'newline\'},\'*\')" style="display:block;width:300px;height:40px;background:#fecaca">newline</a>',
	'<svg width="300" height="40"><a id="v-xlink" xlink:href="javascript:top.postMessage({pwned:\'xlink\'},\'*\')"><rect width="300" height="40" fill="#bbf7d0"/></a></svg>',
	'<svg width="300" height="40"><a id="v-animate"><animate attributeName="href" values="javascript:top.postMessage({pwned:\'animate\'},\'*\')"/><rect width="300" height="40" fill="#bfdbfe"/></a></svg>',
	'<svg width="300" height="40"><a id="v-set"><set attributeName="href" to="javascript:top.postMessage({pwned:\'set\'},\'*\')"/><rect width="300" height="40" fill="#e9d5ff"/></a></svg>',
].join("");

/** A host page as a web host builds it: the view in an iframe sandboxed with
 * allow-scripts allow-same-origin under the view CSP; it answers
 * ui/initialize with a dark theme and a fixed width, then sends the tool
 * input and the tool result once the view says it is initialized. A second
 * iframe, the positive control, shows the page HTML under the same flags
 * without the view. */
function hostPage(
	view: string,
	args: unknown,
	result: CallToolResult,
	control: string,
): string {
	const attribute = (html: string) =>
		html.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
	const guarded = view.replace(
		"<head>",
		`<head><meta http-equiv="Content-Security-Policy" content="${attribute(VIEW_CSP)}">`,
	);
	return `<!DOCTYPE html><html><body style="margin:0">
<iframe id="view" sandbox="allow-scripts allow-same-origin" style="display:block;width:600px;height:200px;border:0" srcdoc="${attribute(guarded)}"></iframe>
<iframe id="control" sandbox="allow-scripts allow-same-origin" style="display:block;width:600px;height:300px;border:0" srcdoc="${attribute(control)}"></iframe>
<script>
window.hostLog = [];
window.pwned = [];
const toolArgs = ${JSON.stringify(args)};
const toolResult = ${JSON.stringify(result).replaceAll("</", "<\\/")};
const view = document.getElementById("view");
const post = (message) => view.contentWindow.postMessage(message, "*");
window.addEventListener("message", (event) => {
	const message = event.data;
	if (message && message.pwned) window.pwned.push(message.pwned);
	if (event.source !== view.contentWindow || !message || message.jsonrpc !== "2.0") return;
	window.hostLog.push(message.method ?? "response");
	if (message.method === "ui/initialize")
		post({ jsonrpc: "2.0", id: message.id, result: {
			protocolVersion: "2026-01-26",
			hostCapabilities: {},
			hostInfo: { name: "harness", version: "1" },
			hostContext: { theme: "dark", displayMode: "inline", containerDimensions: { width: 600, maxHeight: 4000 } },
		} });
	if (message.method === "ui/notifications/initialized") {
		post({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: toolArgs } });
		post({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: toolResult });
	}
	if (message.method === "ui/notifications/size-changed") {
		window.lastSize = message.params;
		view.style.height = message.params.height + "px";
	}
});
</script></body></html>`;
}

/** Click the middle of each element of `frame` matching an id, waiting for a
 * script it would run. */
async function clickEach(
	tab: import("puppeteer").Page,
	frame: import("puppeteer").Frame,
	ids: string[],
): Promise<void> {
	for (const id of ids) {
		const element = await frame.$(`#${id}`);
		const box = await element?.boundingBox();
		if (!box) throw new Error(`Link ${id} is not on screen.`);
		await tab.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
}

const LINK_IDS = ["v-tab", "v-nl", "v-xlink", "v-animate", "v-set"];

describe("ui://maket/page in a minimal MCP Apps host", () => {
	it("lists the linked tool, reads the view, initializes it under its CSP and the web-host flags, renders a real snapshot in a nested sandboxed frame where the five links run no script", async () => {
		const { store, client, documents } = await maketHost();
		const poster = createDocument({
			name: "Poster",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					name: "P1",
					elements: [],
					html: `<h1 data-id="title" style="color:#1d4ed8;margin:0 0 8px">Hello from Maket</h1>${VECTORS}`,
				},
			],
		});
		documents.all().set(poster.name, poster);
		documents.persist(poster.name);

		const tool = (await client.listTools()).tools.find(
			(candidate) => candidate.name === "maket_preview",
		);
		expect(tool?._meta).toEqual({
			ui: { resourceUri: "ui://maket/page", visibility: ["model"] },
		});
		const read = await client.readResource({ uri: "ui://maket/page" });
		const view = read.contents[0] as { text: string; mimeType: string };
		expect(view.mimeType).toBe("text/html;profile=mcp-app");

		const args = { action: "snapshot", doc: "Poster", page: 1 };
		const result = (await client.callTool({
			name: "maket_preview",
			arguments: args,
		})) as CallToolResult;
		expect(result.content.map((item) => item.type)).toEqual(["text", "image"]);
		const page = (
			result.structuredContent as {
				maketPage: { html: string; width: number; height: number };
			}
		).maketPage;
		expect(page).toMatchObject({ width: 794, height: 1123, reduced: false });
		expect(page.html).toContain("Hello from Maket");
		for (const id of LINK_IDS) expect(page.html).toContain(`id="${id}"`);

		if (!browser) throw new Error("Chromium did not start");
		const tab = await browser.newPage();
		await tab.setViewport({ width: 700, height: 1400 });
		try {
			await tab.setContent(hostPage(view.text, args, result, page.html));
			const frameOf = async (
				match: (frame: import("puppeteer").Frame) => Promise<boolean>,
			) => {
				for (let attempt = 0; attempt < 100; attempt += 1) {
					for (const frame of tab.frames())
						if (
							frame !== tab.mainFrame() &&
							(await match(frame).catch(() => false))
						)
							return frame;
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
				throw new Error("Frame not found.");
			};
			const viewFrame = await frameOf((frame) =>
				frame.evaluate(() => Boolean(document.getElementById("status"))),
			);
			const sheet = await frameOf(
				async (frame) =>
					frame.parentFrame() === viewFrame &&
					(await frame.evaluate(() =>
						Boolean(document.body?.textContent?.includes("Hello from Maket")),
					)),
			);
			const control = await frameOf(
				async (frame) =>
					frame.parentFrame() === tab.mainFrame() &&
					frame !== viewFrame &&
					(await frame.evaluate(() =>
						Boolean(document.getElementById("v-tab")),
					)),
			);

			const rendered = await viewFrame.evaluate(() => {
				const nested = document.querySelector("#page iframe");
				return {
					status: document.getElementById("status")?.textContent,
					theme: document.documentElement.dataset.theme,
					transform: document.getElementById("page")?.style.transform,
					sandbox: nested?.getAttribute("sandbox"),
					nestedWidth: nested?.getBoundingClientRect().width,
				};
			});
			expect(rendered).toMatchObject({
				status: "Poster — page 1",
				theme: "dark",
				sandbox: "",
			});
			expect(rendered.transform).toMatch(/^scale\(0\.7\d+\)$/);
			const title = await sheet.evaluate(() => {
				const element = document.querySelector('[data-id="title"]');
				return element ? getComputedStyle(element).color : null;
			});
			expect(title).toBe("rgb(29, 78, 216)");

			await clickEach(tab, sheet, LINK_IDS);
			expect(
				await tab.evaluate(
					() => (window as unknown as { pwned: string[] }).pwned,
				),
			).toEqual([]);

			await clickEach(tab, control, ["v-tab"]);
			expect(
				await tab.evaluate(
					() => (window as unknown as { pwned: string[] }).pwned,
				),
			).toEqual(["tab"]);

			const host = await tab.evaluate(() => ({
				log: (window as unknown as { hostLog: string[] }).hostLog,
				size: (window as unknown as { lastSize?: { height: number } }).lastSize,
			}));
			expect(host.log.slice(0, 2)).toEqual([
				"ui/initialize",
				"ui/notifications/initialized",
			]);
			expect(host.size?.height).toBeGreaterThan(800);
		} finally {
			await tab.close();
			await client.close();
			store.close();
		}
	}, 90_000);
});
