import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import {
	type CallToolResult,
	InMemoryTransport,
	McpServer,
} from "@modelcontextprotocol/server";
import { asValue } from "awilix";
import puppeteer, { type Browser, type Frame, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppContainer } from "../bootstrap.js";
import { mountAppViews, mountTools } from "../core/container.js";
import {
	CHROMIUM_HEADLESS,
	shouldDisableSandbox,
} from "../lib/chromium-sandbox.js";
import { MAKET_READER_MAX_ANSWER } from "../lib/maket-reader.js";
import { createBrowserPool } from "../services/browser-pool.js";
import { createConfig } from "../services/config.js";
import type { DocumentStateMutations } from "../services/document-state-mutations.js";
import type { Documents } from "../services/documents.js";
import type { McpAppViews } from "../services/mcp-app-views.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketMermaidTool } from "./mermaid.js";
import { createMaketPreviewTool } from "./preview.js";
import { createMaketReaderTool } from "./reader.js";

/** The reader built by `npm run build:mcp-view`. */
const VIEWS_DIR = resolve(import.meta.dirname, "../../../../mcp-views");

let browser: Browser | undefined;
let tmp: string;

beforeAll(async () => {
	if (!existsSync(join(VIEWS_DIR, "maket-reader.html")))
		execFileSync(
			process.execPath,
			[resolve(VIEWS_DIR, "../scripts/build-mcp-view.mjs")],
			{ stdio: "inherit", timeout: 180_000 },
		);
	tmp = mkdtempSync(join(tmpdir(), "maket-reader-"));
	await writeImages(join(tmp, "assets"));
	browser = await puppeteer.launch({
		headless: CHROMIUM_HEADLESS,
		args: shouldDisableSandbox() ? ["--no-sandbox"] : [],
	});
}, 240_000);

afterAll(async () => {
	await browser?.close();
	rmSync(tmp, { recursive: true, force: true });
}, 30_000);

/** Nineteen small images and one large noisy photo that only fits an
 * answer once downscaled. */
async function writeImages(dir: string): Promise<void> {
	mkdirSync(dir, { recursive: true });
	const { Jimp } = await import("jimp");
	for (let index = 0; index < 19; index += 1) {
		const image = new Jimp({
			width: 600,
			height: 400,
			color: (((index * 47) % 255) * 0x1000000 + 0x78c8ff) >>> 0,
		});
		writeFileSync(
			join(dir, `img-${index}.png`),
			await image.getBuffer("image/png"),
		);
	}
	const photo = new Jimp({ width: 2400, height: 1600, color: 0xffffffff });
	const pixels = photo.bitmap.data;
	for (let index = 0; index < pixels.length; index += 1)
		pixels[index] = index % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
	writeFileSync(
		join(dir, "photo.jpg"),
		await photo.getBuffer("image/jpeg", { quality: 90 }),
	);
}

const A4 = {
	format: "A4",
	orientation: "portrait",
	w: 210,
	h: 297,
	bg: "#fff",
} as const;

/** The five links of review 1548c072, each posting to the top window when
 * its script runs. */
const VECTORS = [
	'<a id="v-tab" href="java&#x09;script:top.postMessage({pwned:\'tab\'},\'*\')" style="display:block;width:300px;height:40px;background:#fde68a">tab</a>',
	'<a id="v-nl" href="java&#x0A;script:top.postMessage({pwned:\'newline\'},\'*\')" style="display:block;width:300px;height:40px;background:#fecaca">newline</a>',
	'<svg width="300" height="40"><a id="v-xlink" xlink:href="javascript:top.postMessage({pwned:\'xlink\'},\'*\')"><rect width="300" height="40" fill="#bbf7d0"/></a></svg>',
	'<svg width="300" height="40"><a id="v-animate"><animate attributeName="href" values="javascript:top.postMessage({pwned:\'animate\'},\'*\')"/><rect width="300" height="40" fill="#bfdbfe"/></a></svg>',
	'<svg width="300" height="40"><a id="v-set"><set attributeName="href" to="javascript:top.postMessage({pwned:\'set\'},\'*\')"/><rect width="300" height="40" fill="#e9d5ff"/></a></svg>',
].join("");
const LINK_IDS = ["v-tab", "v-nl", "v-xlink", "v-animate", "v-set"];

const IMAGES = [
	...Array.from({ length: 19 }, (_, index) => `img-${index}.png`),
	"photo.jpg",
];

/** A disposable Maket with maket_preview, maket_reader and maket_mermaid,
 * reached by a host client over an in-memory transport. */
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
			env: { MAKET_DATA_DIR: tmp, MAKET_MCP_VIEWS_DIR: VIEWS_DIR },
			homedir: () => "/nowhere",
		}),
	});
	const documents = container.resolve<Documents>("documents");
	documents.loadAll();
	container.register({
		toolRegistry: asValue(
			new Map([
				["maket_preview", createMaketPreviewTool(container.cradle as never)],
				["maket_reader", createMaketReaderTool(container.cradle as never)],
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
	const mermaid = createMaketMermaidTool(container.cradle as never);
	return {
		store,
		client,
		documents,
		mermaid,
		mutations: container.resolve<DocumentStateMutations>(
			"documentStateMutations",
		),
	};
}

type Host = Awaited<ReturnType<typeof maketHost>>;

/** The CSP a host builds for ui://maket/page from the spec defaults and the
 * resource's declared font hosts. */
const HOST_CSP = [
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

const attribute = (html: string) =>
	html.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

/** A host page as a web host builds it: the view in an iframe sandboxed with
 * allow-scripts allow-same-origin under the host CSP; it answers
 * ui/initialize with a dark theme, sends the tool input and result once the
 * view is initialized, forwards tools/call to the Maket server only for
 * tools visible to apps, measures every answer, and records open-link. A
 * second iframe, the positive control, shows `control` under the same flags
 * without the reader. */
function hostPage(
	view: string,
	args: unknown,
	result: CallToolResult,
	control = "",
): string {
	const guarded = view.replace(
		"<head>",
		`<head><meta http-equiv="Content-Security-Policy" content="${attribute(HOST_CSP)}">`,
	);
	return `<!DOCTYPE html><html><body style="margin:0">
<iframe id="view" sandbox="allow-scripts allow-same-origin" style="display:block;width:760px;height:200px;border:0" srcdoc="${attribute(guarded)}"></iframe>
<iframe id="control" sandbox="allow-scripts allow-same-origin" style="display:block;width:600px;height:300px;border:0" srcdoc="${attribute(control)}"></iframe>
<script>
window.hostLog = [];
window.pwned = [];
window.answers = [];
window.links = [];
const toolArgs = ${JSON.stringify(args)};
const toolResult = ${JSON.stringify(result).replaceAll("</", "<\\/")};
const view = document.getElementById("view");
const post = (message) => view.contentWindow.postMessage(message, "*");
window.addEventListener("message", async (event) => {
	const message = event.data;
	if (message && message.pwned) window.pwned.push(message.pwned);
	if (event.source !== view.contentWindow || !message || message.jsonrpc !== "2.0") return;
	window.hostLog.push(message.method ?? "response");
	if (message.method === "ui/initialize")
		post({ jsonrpc: "2.0", id: message.id, result: {
			protocolVersion: "2026-01-26",
			hostCapabilities: {},
			hostInfo: { name: "harness", version: "1" },
			hostContext: { theme: "dark", displayMode: "inline", containerDimensions: { width: 760, maxHeight: 4000 } },
		} });
	if (message.method === "ui/notifications/initialized") {
		post({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: toolArgs } });
		post({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: toolResult });
	}
	if (message.method === "ui/notifications/size-changed") {
		window.lastSize = message.params;
		view.style.height = message.params.height + "px";
	}
	if (message.method === "ui/open-link") {
		window.links.push(message.params.url);
		post({ jsonrpc: "2.0", id: message.id, result: {} });
	}
	if (message.method === "tools/call") {
		const answer = await window.hostCallTool(message.params.name, message.params.arguments);
		window.answers.push({ name: message.params.name, action: message.params.arguments.action, length: answer.length });
		const parsed = JSON.parse(answer);
		post(parsed.refused
			? { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: parsed.refused } }
			: { jsonrpc: "2.0", id: message.id, result: parsed });
	}
});
</script></body></html>`;
}

async function until<T>(
	read: () => Promise<T>,
	ok: (value: T) => boolean,
	what: string,
	timeout = 20_000,
): Promise<T> {
	const end = Date.now() + timeout;
	let last: T | undefined;
	while (Date.now() < end) {
		last = await read().catch(() => undefined as T);
		if (last !== undefined && ok(last)) return last;
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error(`${what}: still ${JSON.stringify(last)}`);
}

/** Open the reader for a maket_preview call in a host page; answers the tab
 * and the view frame once the reader shows its document. */
async function openReader(
	host: Host,
	args: Record<string, unknown>,
	control = "",
): Promise<{ tab: Page; view: Frame; result: CallToolResult }> {
	if (!browser) throw new Error("Chromium did not start");
	const tools = (await host.client.listTools()).tools;
	const appTools = new Set(
		tools
			.filter((tool) =>
				(
					(tool._meta?.ui as { visibility?: string[] } | undefined)
						?.visibility ?? ["model", "app"]
				).includes("app"),
			)
			.map((tool) => tool.name),
	);
	const read = await host.client.readResource({ uri: "ui://maket/page" });
	const viewHtml = (read.contents[0] as { text: string }).text;
	const result = (await host.client.callTool({
		name: "maket_preview",
		arguments: args,
	})) as CallToolResult;
	const tab = await browser.newPage();
	await tab.setViewport({ width: 800, height: 1000 });
	await tab.exposeFunction(
		"hostCallTool",
		async (name: string, toolArgs: Record<string, unknown>) => {
			if (!appTools.has(name))
				return JSON.stringify({ refused: `${name} is not callable by apps` });
			return JSON.stringify(
				await host.client.callTool({ name, arguments: toolArgs }),
			);
		},
	);
	await tab.setContent(hostPage(viewHtml, args, result, control));
	const view = await until(
		async () => {
			for (const frame of tab.frames())
				if (
					frame.parentFrame() === tab.mainFrame() &&
					(await frame.evaluate(
						() =>
							document
								.querySelector("[data-maket-reader]")
								?.getAttribute("data-maket-reader") === "document",
					))
				)
					return frame;
			return undefined;
		},
		(frame) => frame !== undefined,
		"reader frame",
	);
	return { tab, view: view as Frame, result };
}

const hostState = (tab: Page) =>
	tab.evaluate(() => {
		const w = window as unknown as {
			pwned: string[];
			answers: { name: string; action: string; length: number }[];
			links: string[];
			hostLog: string[];
			lastSize?: { height: number };
		};
		return {
			pwned: w.pwned,
			answers: w.answers,
			links: w.links,
			log: w.hostLog,
			size: w.lastSize,
		};
	});

async function clickIn(tab: Page, frame: Frame, selector: string) {
	const element = await frame.$(selector);
	await element?.scrollIntoView();
	const box = await element?.boundingBox();
	if (!box) throw new Error(`${selector} is not on screen.`);
	await tab.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

describe("the Maket reader in a minimal MCP Apps host", () => {
	it("pages through a large A4 document on demand: page 3 shows its twenty images, every answer under 100 000 characters, a Mermaid diagram renders, and the five links run no script", async () => {
		const host = await maketHost();
		const atlas = createDocument({
			name: "Atlas",
			canvas: A4,
			pages: [
				{
					name: "Links",
					elements: [],
					html: `<h1 data-id="title" style="color:#1d4ed8">Atlas</h1>${VECTORS}`,
				},
				{ name: "Diagram", elements: [], html: '<p data-id="intro">Flow</p>' },
				{
					name: "Gallery",
					elements: [],
					html: `<div data-id="grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px">${IMAGES.map(
						(file, index) =>
							`<img data-id="i${index}" src="/assets/${file}" style="width:100%">`,
					).join("")}</div>`,
				},
				{ name: "End", elements: [], html: '<p data-id="end">End</p>' },
			],
		});
		host.documents.all().set(atlas.name, atlas);
		host.documents.persist(atlas.name);
		const drawn = await host.mermaid.handler(
			{ doc: "Atlas", page: 2, code: "graph TD\n  A[Start]-->B[End]" },
			{} as never,
		);
		expect(drawn.isError).toBeFalsy();

		const tools = (await host.client.listTools()).tools;
		expect(tools.find((tool) => tool.name === "maket_preview")?._meta).toEqual({
			ui: { resourceUri: "ui://maket/page", visibility: ["model"] },
		});
		expect(tools.find((tool) => tool.name === "maket_reader")?._meta).toEqual({
			ui: { resourceUri: "ui://maket/page", visibility: ["app"] },
		});

		const control = (
			(await host.client.callTool({
				name: "maket_reader",
				arguments: { action: "page", doc: "Atlas", page: 1 },
			})) as CallToolResult
		).structuredContent as { html: string };
		const { tab, view, result } = await openReader(
			host,
			{ action: "show", doc: "Atlas", layout: "page" },
			control.html,
		);
		try {
			expect(JSON.stringify(result).length).toBeLessThan(3_000);
			await until(
				() =>
					view.evaluate(() =>
						Boolean(document.querySelector('[data-id="title"]')),
					),
				Boolean,
				"page 1",
			);
			expect(
				await view.evaluate(() => ({
					theme: document.documentElement.dataset.theme === "dark",
					color: getComputedStyle(
						document.querySelector('[data-id="title"]') as Element,
					).color,
				})),
			).toEqual({ theme: true, color: "rgb(29, 78, 216)" });
			for (const id of LINK_IDS) await clickIn(tab, view, `#${id}`);
			await new Promise((done) => setTimeout(done, 500));
			expect((await hostState(tab)).pwned).toEqual([]);
			const control = tab
				.frames()
				.find(
					(frame) => frame.parentFrame() === tab.mainFrame() && frame !== view,
				);
			if (!control) throw new Error("No control frame.");
			await clickIn(tab, control, "#v-tab");
			await until(
				async () => (await hostState(tab)).pwned,
				(pwned) => pwned.length > 0,
				"control link",
			);
			expect((await hostState(tab)).pwned).toEqual(["tab"]);

			await clickIn(tab, view, '[aria-label^="Next page"]');
			await until(
				() =>
					view.evaluate(() =>
						Boolean(
							document.querySelector(
								"[data-id] svg, svg[aria-roledescription]",
							),
						),
					),
				Boolean,
				"Mermaid diagram on page 2",
			);

			await view.select("[data-maket-reader-contents]", "3");
			const shown = await until(
				() =>
					view.evaluate(() =>
						[...document.querySelectorAll('[data-id^="i"]')].map((image) => {
							const element = image as HTMLImageElement;
							return element.complete &&
								element.naturalWidth > 0 &&
								element.src.startsWith("data:image/")
								? element.naturalWidth
								: 0;
						}),
					),
				(widths) => widths.length === 20 && widths.every((width) => width > 0),
				"twenty images on page 3",
				60_000,
			);
			expect(Math.max(...shown)).toBeLessThan(2400);

			const state = await hostState(tab);
			const calls = state.answers;
			expect(calls.filter((call) => call.action === "image")).toHaveLength(20);
			expect(calls.every((call) => call.name === "maket_reader")).toBe(true);
			expect(Math.max(...calls.map((call) => call.length))).toBeLessThanOrEqual(
				MAKET_READER_MAX_ANSWER,
			);
			expect(state.log.slice(0, 2)).toEqual([
				"ui/initialize",
				"ui/notifications/initialized",
			]);
			expect(state.size?.height).toBe(640);

			await clickIn(tab, view, "[data-maket-reader-open]");
			await until(
				async () => (await hostState(tab)).links,
				(links) => links.length === 1,
				"open link",
			);
			expect((await hostState(tab)).links[0]).toMatch(
				new RegExp(`^http://127\\.0\\.0\\.1:\\d+/documents/${atlas.id}/read$`),
			);
		} finally {
			await tab.close();
			await host.client.close();
			host.store.close();
		}
	}, 120_000);

	it("scrolls a very tall AUTO page inside the fixed-height reader", async () => {
		const host = await maketHost();
		const scroll = createDocument({
			name: "Scroll",
			canvas: { ...A4, format: "AUTO" },
			pages: [
				{
					name: "Long",
					elements: [],
					html: '<div data-id="tall" style="height:9000px;background:linear-gradient(#ffffff,#2563eb)">Top</div><p data-id="bottom">Bottom</p>',
				},
			],
		});
		host.documents.all().set(scroll.name, scroll);
		host.documents.persist(scroll.name);
		const { tab, view } = await openReader(host, {
			action: "show",
			doc: "Scroll",
		});
		try {
			await until(
				() =>
					view.evaluate(() =>
						Boolean(document.querySelector('[data-id="bottom"]')),
					),
				Boolean,
				"tall page",
			);
			const scrolled = await view.evaluate(async () => {
				const surface = document.querySelector(
					"[data-reading-workspace]",
				) as HTMLElement;
				const before = {
					client: surface.clientHeight,
					scroll: surface.scrollHeight,
				};
				surface.scrollTop = surface.scrollHeight;
				await new Promise((done) => setTimeout(done, 200));
				const bottom = document
					.querySelector('[data-id="bottom"]')
					?.getBoundingClientRect();
				return {
					...before,
					top: surface.scrollTop,
					bottomVisible: Boolean(
						bottom && bottom.top >= 0 && bottom.bottom <= window.innerHeight,
					),
				};
			});
			expect(scrolled.client).toBeLessThanOrEqual(640);
			expect(scrolled.scroll).toBeGreaterThan(3 * scrolled.client);
			expect(scrolled.top).toBeGreaterThan(0);
			expect(scrolled.bottomVisible).toBe(true);
			expect((await hostState(tab)).size?.height).toBe(640);
			expect(
				await tab.evaluate(
					() => (document.getElementById("view") as HTMLElement).offsetHeight,
				),
			).toBe(640);
		} finally {
			await tab.close();
			await host.client.close();
			host.store.close();
		}
	}, 90_000);

	it("saves a bound checkbox and a JSON Forms field through the app-only call, reloads on a stale revision and refuses on a locked document", async () => {
		const host = await maketHost();
		const survey = createDocument({
			name: "Survey",
			canvas: A4,
			dataModel: "state",
			pages: [
				{
					name: "Answer",
					elements: [],
					html: '<h1 data-id="heading">{{ state.title }}</h1><label data-id="done-label"><input data-id="done" type="checkbox" data-maket-bind="state.done"> Done</label>',
				},
				{
					name: "Form",
					elements: [],
					jsonForms: {
						uischema: { type: "Control", scope: "#/properties/title" },
					},
				},
			],
		});
		host.store.saveDoc(survey);
		host.store.initializeDocumentState(
			survey.id,
			{
				type: "object",
				properties: { title: { type: "string" }, done: { type: "boolean" } },
				required: ["title", "done"],
			},
			{ title: "Draft", done: false },
		);
		host.documents.loadAll();
		const current = () => host.store.loadCurrentDocumentState(survey.id);
		expect(current()?.revision).toBe(1);

		const { tab, view } = await openReader(host, {
			action: "show",
			doc: "Survey",
			layout: "scroll",
		});
		try {
			await until(
				() =>
					view.evaluate(() =>
						Boolean(document.querySelector('[data-id="done"]')),
					),
				Boolean,
				"bound checkbox",
			);
			await clickIn(tab, view, '[data-id="done"]');
			await until(
				async () => current(),
				(state) => state?.revision === 2,
				"revision 2",
			);
			expect(current()?.data).toEqual({ title: "Draft", done: true });

			const field = 'input[data-maket-bind][data-maket-type="string"]';
			await until(
				() => view.evaluate((s) => Boolean(document.querySelector(s)), field),
				Boolean,
				"JSON Forms field",
			);
			await clickIn(tab, view, field);
			await view.evaluate((s) => {
				const input = document.querySelector(s) as HTMLInputElement;
				input.select();
			}, field);
			await tab.keyboard.type("Signed");
			await tab.keyboard.press("Enter");
			await until(
				async () => current(),
				(state) => state?.revision === 3,
				"revision 3",
			);
			expect(current()?.data).toEqual({ title: "Signed", done: true });
			await until(
				() =>
					view.evaluate(
						() => document.querySelector('[data-id="heading"]')?.textContent,
					),
				(text) => text === "Signed",
				"heading refreshed from revision 3",
			);

			await host.mutations.patchTerminal("Survey", 3, {
				op: "replace",
				path: "/title",
				value: "Elsewhere",
			});
			expect(current()?.revision).toBe(4);
			await clickIn(tab, view, '[data-id="done"]');
			await until(
				() =>
					view.evaluate(
						() =>
							document.querySelector("[data-maket-reader-notice]")
								?.textContent ?? "",
					),
				(text) => text.includes("changed elsewhere"),
				"stale notice",
			);
			await until(
				() =>
					view.evaluate(
						() => document.querySelector('[data-id="heading"]')?.textContent,
					),
				(text) => text === "Elsewhere",
				"page reloaded with the current values",
			);
			expect(current()?.revision).toBe(4);

			const locked = host.documents.resolve("Survey");
			if (!locked) throw new Error("Survey missing.");
			locked.meta = { ...locked.meta, locked: true };
			host.documents.persist("Survey");
			await clickIn(tab, view, '[data-id="done"]');
			await until(
				() =>
					view.evaluate(
						() =>
							document.querySelector("[data-maket-reader-notice]")
								?.textContent ?? "",
					),
				(text) => text.includes("locked"),
				"locked notice",
			);
			expect(current()?.revision).toBe(4);
			expect(current()?.data).toEqual({ title: "Elsewhere", done: true });
			const writes = (await hostState(tab)).answers.filter(
				(call) => call.action === "write",
			);
			expect(writes).toHaveLength(4);
		} finally {
			await tab.close();
			await host.client.close();
			host.store.close();
		}
	}, 120_000);
});
