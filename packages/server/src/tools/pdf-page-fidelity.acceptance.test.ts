import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRenderSurfaceHtml } from "../lib/render-surface-html.js";
import { createAssetsService } from "../services/assets.js";
import {
	type BrowserPool,
	createBrowserPool,
} from "../services/browser-pool.js";
import type { Config } from "../services/config.js";
import { createDocuments, type Documents } from "../services/documents.js";
import { createPdfService } from "../services/pdf.js";
import { createSQLiteStore, type Store } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketPdfTool } from "./pdf.js";

const CANVAS = {
	format: "DESKTOP",
	orientation: "landscape",
	w: 288,
	h: 205,
	bg: "#F4F5F7",
} as const;

const COVER = `<style>
.cv{width:288mm;height:205mm;padding:12mm;background:#123456;color:#fedcba;font-family:monospace;display:flex;flex-direction:column;gap:6mm}
.cv h1{font-size:28px;color:#f0c419}
.cv .card{background:#ffffff;color:#2b2b2b;border-radius:8px;padding:4mm;box-shadow:0 2px 6px rgba(0,0,0,.3)}
</style>
<div class="cv" data-id="cv"><h1 data-id="cv-h">Cover</h1><div class="card" data-id="cv-c">Styled card</div></div>`;

function phone(n: number): string {
	return `<div class="col" data-id="c${n}"><span class="cap" data-id="c${n}-cap">Phone ${n}</span><div class="pf" data-id="p${n}">
      <div class="hh" data-id="p${n}h"><span class="lm" data-id="p${n}lm">T</span><span class="logo" data-id="p${n}l">TRUST</span></div>
      <div class="bd" data-id="p${n}b"><span class="h2" data-id="p${n}t">What is happening</span><span class="stick" data-id="p${n}s">Sticky bar</span></div>
    </div></div>`;
}

/** Shaped like a page with three phone frames: a page-level style sheet whose
 * last declaration is a box-shadow without a semicolon, then a second style
 * sheet inside the root element. */
const PHONES = `<style>
.tr{width:288mm;height:205mm;padding:6mm 10mm;background:#eef1f4;color:#1c2733;font-family:monospace;display:flex;flex-direction:column;gap:4mm;overflow:hidden;--shadow:0 1px 3px rgba(0,0,0,.25)}
.tr *{box-sizing:border-box}
.tr .phs{display:flex;gap:10mm;justify-content:center;align-items:flex-start;flex:1;min-height:0}
.tr .col{display:flex;flex-direction:column;align-items:center;gap:4px}
.tr .cap{font-size:12px;color:#6b7785}
.tr .pf{zoom:0.8;width:390px;height:844px;border:1px solid #9aa5b1;border-radius:32px;overflow:hidden;background:#0b1d2e;display:flex;flex-direction:column;flex:none}
.tr .hh{height:48px;display:flex;align-items:center;gap:6px;padding:0 8px;background:#26415c;color:#ffd166}
.tr .lm{width:22px;height:22px;border-radius:4px;background:#ffd166;color:#26415c;display:flex;align-items:center;justify-content:center}
.tr .bd{padding:12px 16px;display:flex;flex-direction:column;gap:12px;color:#e6edf3}
.tr .h2{font-size:20px;font-weight:650}
.tr .stick{display:flex;align-items:center;height:44px;padding:0 12px;background:#3a6ea5;box-shadow:var(--shadow)}
</style>
<div class="tr" data-id="mh"><style data-id="mh-z">.tr .col{width:312px;align-items:flex-start}.tr .pf{zoom:1;transform:scale(0.8);transform-origin:top left;margin:0 -78px -169px 0}.tr .cap{align-self:center}</style>
  <div class="phs" data-id="mh-phs">${phone(1)}${phone(2)}${phone(3)}</div>
</div>`;

const CLOSING = `<style>.end{padding:20mm;color:#8a1538;font-family:serif;font-size:32px}</style><p class="end" data-id="end">The end</p>`;

/** Valid on its own page, but `body` is rebased onto the printed page in a
 * multi-page PDF while the preview keeps it on the document body. */
const SHELL_SELECTOR = `<style>body > [data-id="bx"]{width:50mm}</style><div data-id="bx" style="height:20mm;background:#c0392b">Shell</div>`;

interface PdfPageContent {
	colours: string[];
	fonts: string[];
}

/** Read each page's fill colours and base fonts out of a Chromium PDF,
 * following the page's content streams and nested form XObjects. */
function readPdfPages(buffer: Buffer): PdfPageContent[] {
	const raw = buffer.toString("latin1");
	const objects = new Map<string, { dict: string; stream: string }>();
	for (const m of raw.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) {
		const body = m[2] ?? "";
		const streamAt = body.search(/stream\r?\n/);
		const dict = streamAt < 0 ? body : body.slice(0, streamAt);
		let stream = "";
		if (streamAt >= 0) {
			const data = body
				.slice(streamAt)
				.replace(/^stream\r?\n/, "")
				.replace(/\r?\nendstream\s*$/, "");
			stream = dict.includes("/FlateDecode")
				? inflateSync(Buffer.from(data, "latin1")).toString("latin1")
				: data;
		}
		objects.set(m[1] ?? "", { dict, stream });
	}
	const refs = (text: string) =>
		[...text.matchAll(/(\d+) 0 R/g)].map((r) => r[1] ?? "");
	/** Value of `/key` in a dictionary: inline `<<…>>`, `[…]`, or dereferenced. */
	const value = (dict: string, key: string): string => {
		const at = dict.search(new RegExp(`/${key}(?![A-Za-z])`));
		if (at < 0) return "";
		const rest = dict.slice(at + key.length + 1).trimStart();
		const ref = rest.match(/^(\d+) 0 R/);
		if (ref?.[1]) return objects.get(ref[1])?.dict ?? "";
		if (rest.startsWith("[")) return rest.slice(0, rest.indexOf("]") + 1);
		if (!rest.startsWith("<<")) return "";
		let depth = 0;
		for (let i = 0; i < rest.length - 1; i++) {
			const pair = rest.slice(i, i + 2);
			if (pair === "<<") depth++;
			else if (pair === ">>") depth--;
			else continue;
			i++;
			if (depth === 0) return rest.slice(0, i + 1);
		}
		return rest;
	};
	const pages: string[] = [];
	const walk = (dict: string) => {
		for (const id of refs(value(dict, "Kids"))) {
			const kid = objects.get(id)?.dict ?? "";
			if (/\/Type\s*\/Pages\b/.test(kid)) walk(kid);
			else pages.push(kid);
		}
	};
	const root = [...objects.values()].find((o) =>
		/\/Type\s*\/Pages\b/.test(o.dict),
	);
	walk(root?.dict ?? "");
	return pages.map((page) => {
		const colours = new Set<string>();
		const fonts = new Set<string>();
		const seen = new Set<string>();
		const visit = (resources: string, streams: string[]) => {
			for (const ops of streams)
				for (const c of ops.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g))
					colours.add(
						c
							.slice(1, 4)
							.map((v) => Number(v).toFixed(2))
							.join(" "),
					);
			for (const id of refs(value(resources, "Font"))) {
				const name = objects
					.get(id)
					?.dict.match(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([^\s/>]+)/)?.[1];
				if (name) fonts.add(name);
			}
			for (const id of refs(value(resources, "XObject"))) {
				const form = objects.get(id);
				if (!form || seen.has(id) || !form.dict.includes("/Form")) continue;
				seen.add(id);
				visit(value(form.dict, "Resources"), [form.stream]);
			}
		};
		visit(
			value(page, "Resources"),
			refs(page.match(/\/Contents\s*(\[[^\]]*\]|\d+ 0 R)/)?.[1] ?? "").map(
				(id) => objects.get(id)?.stream ?? "",
			),
		);
		return { colours: [...colours].sort(), fonts: [...fonts].sort() };
	});
}

describe("maket_pdf — page fidelity", () => {
	let tmp: string;
	let store: Store;
	let documents: Documents;
	let browserPool: BrowserPool;
	let tool: ReturnType<typeof createMaketPdfTool>;

	beforeAll(() => {
		tmp = mkdtempSync(join(tmpdir(), "maket-pdf-fidelity-"));
		store = createSQLiteStore(":memory:");
		documents = createDocuments({ store });
		const config = { ASSETS_DIR: tmp, EXPORTS_DIR: tmp } as unknown as Config;
		const assets = createAssetsService({ assetsDir: tmp });
		browserPool = createBrowserPool();
		const pdfService = createPdfService({
			documents,
			config,
			assets,
			browserPool,
		});
		tool = createMaketPdfTool({ documents, pdfService, config });
	});

	afterAll(async () => {
		await browserPool.dispose();
		store.close();
		rmSync(tmp, { recursive: true, force: true });
	}, 30_000);

	function saveDoc(name: string, pages: Array<[string, string]>) {
		store.saveDoc(
			createDocument({
				name,
				canvas: { ...CANVAS },
				pages: pages.map(([pageName, html]) => ({
					name: pageName,
					elements: [],
					html,
				})),
			}),
		);
		documents.loadAll();
	}

	async function exportPdf(name: string) {
		const result = await tool.handler({ doc: name }, {} as never);
		const report = result.content
			.map((c) => ("text" in c ? c.text : ""))
			.join("\n");
		const path = report.match(/PDF exported: (\S+\.pdf)/)?.[1];
		return {
			result,
			report,
			pages: path ? readPdfPages(readFileSync(path)) : [],
		};
	}

	/** Print each page alone, as authored: the reference rendering. */
	async function previewPdfPage(html: string): Promise<PdfPageContent> {
		const browser = await browserPool.get();
		const page = await browser.newPage();
		try {
			await page.setContent(
				buildRenderSurfaceHtml({
					canvas: CANVAS,
					pageHtmls: [html],
					charteCss: "",
					surface: { kind: "print" },
				}),
				{ waitUntil: "load" },
			);
			const pdf = await page.pdf({
				width: `${CANVAS.w}mm`,
				height: `${CANVAS.h}mm`,
				printBackground: true,
				margin: { top: "0", right: "0", bottom: "0", left: "0" },
			});
			const [first] = readPdfPages(Buffer.from(pdf));
			return first ?? { colours: [], fonts: [] };
		} finally {
			await page.close();
		}
	}

	it("EXP-010 AC1 each page of an exported PDF has the layout, the fonts and the colours of its preview", async () => {
		const pages: Array<[string, string]> = [
			["Cover", COVER],
			["Phones", PHONES],
			["Closing", CLOSING],
		];
		saveDoc("fidelity-ac1", pages);

		const { result, report, pages: printed } = await exportPdf("fidelity-ac1");

		expect(result.isError).toBeUndefined();
		expect(report).toContain("3 pages");
		expect(report).toContain("Every page renders as its preview.");
		expect(printed).toHaveLength(3);
		for (const [index, [, html]] of pages.entries()) {
			expect(printed[index]).toEqual(await previewPdfPage(html));
		}
	}, 60_000);

	it("EXP-010 AC2 a page with phone frames side by side is exported with its frames and their styled content", async () => {
		saveDoc("fidelity-ac2", [
			["Cover", COVER],
			["Phones", PHONES],
		]);

		const { report, pages: printed } = await exportPdf("fidelity-ac2");

		expect(report).toContain("Every page renders as its preview.");
		const phones = printed[1];
		expect(phones).toEqual(await previewPdfPage(PHONES));
		// Frame body, header, logo mark, sticky bar and page background fills.
		for (const fill of [
			"0.04 0.11 0.18",
			"0.15 0.25 0.36",
			"1.00 0.82 0.40",
			"0.23 0.43 0.65",
			"0.93 0.95 0.96",
		])
			expect(phones?.colours).toContain(fill);
	}, 60_000);

	it("EXP-010 AC3 the export reports a page whose PDF rendering differs from its preview, with its number and name", async () => {
		saveDoc("fidelity-ac3", [
			["Cover", COVER],
			["Shell selector", SHELL_SELECTOR],
			["Closing", CLOSING],
		]);

		const { result, report } = await exportPdf("fidelity-ac3");

		expect(result.isError).toBeUndefined();
		expect(report).toContain(
			"1 page renders differently in the PDF than in the preview:",
		);
		expect(report).toMatch(
			/page 2 "Shell selector": 1 element differs \(first: div data-id="bx" box 189×76 at 0,0 instead of \d+×76 at 0,0\)/,
		);
		expect(report).toContain(
			"maket_preview action=snapshot doc=fidelity-ac3 page=2",
		);
		expect(report).not.toContain('page 1 "Cover"');
		expect(report).not.toContain('page 3 "Closing"');
	}, 60_000);
});
