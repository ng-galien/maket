import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	CHROMIUM_HEADLESS,
	shouldDisableSandbox,
} from "../lib/chromium-sandbox.js";
import { createBrowserPool } from "../services/browser-pool.js";
import { createBus } from "../services/bus.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketMermaidTool } from "./mermaid.js";

let browser: Browser | undefined;

beforeAll(async () => {
	browser = await puppeteer.launch({
		headless: CHROMIUM_HEADLESS,
		args: shouldDisableSandbox() ? ["--no-sandbox"] : [],
	});
}, 30_000);

afterAll(async () => {
	await browser?.close();
}, 30_000);

function setup(charte?: Record<string, Record<string, string>>) {
	const store = createSQLiteStore(":memory:");
	store.saveDoc(
		createDocument({
			name: "test",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			...(charte ? { meta: { charte: "brand" } } : {}),
		}),
	);
	if (charte) store.saveCharte({ name: "brand", tokens: charte });
	const documents = createDocuments({ store });
	documents.loadAll();
	const browserPool = createBrowserPool(
		{},
		{
			launch: async () => {
				if (!browser) throw new Error("Chromium did not start");
				return browser;
			},
		},
	);
	const tool = createMaketMermaidTool({
		documents,
		bus: createBus(),
		browserPool,
	});
	return { store, tool };
}

/** The tool answer for `code`, and the longest stall of the event loop
 * while it ran. */
async function drawn(
	tool: ReturnType<typeof setup>["tool"],
	code: string,
): Promise<{ text: string; image: { data: string }; longest: number }> {
	let longest = 0;
	let last = performance.now();
	const monitor = setInterval(() => {
		const now = performance.now();
		longest = Math.max(longest, now - last);
		last = now;
	}, 5);
	try {
		const res = await tool.handler({ doc: "test", page: 1, code }, {} as never);
		const [answer, image] = res.content as unknown as Array<{
			text: string;
			data: string;
		}>;
		return { text: answer?.text ?? "", image: image as never, longest };
	} finally {
		clearInterval(monitor);
	}
}

/** Pixel statistics of an inline PNG: share of dark pixels, of light
 * pixels, and the number of distinct colours. */
async function pixels(data: string) {
	const { Jimp } = await import("jimp");
	const image = await Jimp.read(Buffer.from(data, "base64"));
	const colours = new Set<number>();
	let dark = 0;
	let light = 0;
	const { data: rgba, width, height } = image.bitmap;
	for (let index = 0; index < rgba.length; index += 4) {
		const r = rgba[index] ?? 0;
		const g = rgba[index + 1] ?? 0;
		const b = rgba[index + 2] ?? 0;
		const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		if (luminance < 60) dark += 1;
		if (luminance > 200) light += 1;
		colours.add((r << 16) | (g << 8) | b);
	}
	const total = width * height;
	return {
		width,
		height,
		dark: dark / total,
		light: light / total,
		colours: colours.size,
	};
}

describe("maket_mermaid inline image drawn by Chromium", () => {
	it.each([
		["without a charte", undefined],
		[
			"with a charte",
			{
				color: { background: "#ffffff", text: "#111827", primary: "#7c3aed" },
				diagram: { bg: "#f8fafc", border: "#94a3b8" },
			},
		],
	])(
		"draws the boxes, labels and arrow %s, not a dark silhouette, without blocking the event loop",
		async (_label, charte) => {
			const { store, tool } = setup(charte);
			const result = await drawn(
				tool,
				"graph TD\n  A[Start here]-->B[End there]",
			);
			const stats = await pixels(result.image.data);
			expect(stats.dark).toBeLessThan(0.1);
			expect(stats.light).toBeGreaterThan(0.5);
			expect(stats.colours).toBeGreaterThan(16);
			const said = /Inline image (\d+)×(\d+) px\./.exec(result.text);
			expect(Math.abs(Number(said?.[1]) - stats.width)).toBeLessThanOrEqual(1);
			expect(Math.abs(Number(said?.[2]) - stats.height)).toBeLessThanOrEqual(1);
			expect(result.text).not.toContain("downscaled");
			expect(result.longest).toBeLessThan(200);
			store.close();
		},
		30_000,
	);

	it("inlines the top part of a very tall diagram at a legible scale and says so", async () => {
		const { store, tool } = setup();
		const chain = Array.from(
			{ length: 80 },
			(_, index) => `  N${index}-->N${index + 1}`,
		).join("\n");
		const result = await drawn(tool, `graph TD\n${chain}`);
		expect(result.text).toMatch(
			/Inline image cropped to the top part \(\d+×\d+ px of the full result, shown at \d+×\d+ px\): the whole diagram is on the page\./,
		);
		const stats = await pixels(result.image.data);
		expect(stats.height / stats.width).toBeLessThanOrEqual(2.05);
		expect(stats.width).toBeGreaterThanOrEqual(100);
		expect(Math.max(stats.width, stats.height)).toBeLessThanOrEqual(1600);
		expect(stats.dark).toBeLessThan(0.1);
		expect(result.longest).toBeLessThan(200);
		store.close();
	}, 30_000);
});
