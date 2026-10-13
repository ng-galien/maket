/**
 * preview pack — maket_preview (compound).
 *
 * Compound dispatch:
 *   open     — launch the live-preview URL in the user's default browser.
 *   snapshot — headless-render a page to PNG at its canvas's mm size.
 *   show     — open pages of a document in the Maket reader of MCP Apps
 *              hosts (view ui://maket/page).
 *
 * Deps: `documents` (page lookup + charte CSS), `config` (PORT + EXPORTS_DIR).
 */

import { writeFileSync } from "node:fs";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import {
	fitsInline,
	type InlineFrame,
	inlineFrame,
	inlineImageLine,
} from "../lib/bounded-image.js";
import { cursorRenderOptions } from "../lib/collection-render.js";
import { inlineImages } from "../lib/image-inline.js";
import {
	captureInline,
	type InlineCapture,
	loadSurface,
} from "../lib/inline-capture.js";
import {
	MAKET_PAGE_VIEW_URI,
	type MaketReaderOpening,
	type ReaderDisplay,
	ReaderLayoutSchema,
	ReaderPagesSchema,
	ReaderZoomSchema,
	readerOpening,
	selectedPages,
} from "../lib/maket-reader.js";
import { documentReadingPath, readingLine } from "../lib/reading-link.js";
import { buildRenderSurfaceHtml } from "../lib/render-surface-html.js";
import { resolveSafeOutputPath } from "../lib/safe-output-path.js";
import type { AssetsService } from "../services/assets.js";
import type { BrowserPool, RenderPage } from "../services/browser-pool.js";
import type { CollectionCursors } from "../services/collection-cursor.js";
import type { Config } from "../services/config.js";
import {
	renderDocumentSettled,
	type SettlingDocumentRenderer,
} from "../services/document-renderer.js";
import type { Documents } from "../services/documents.js";
import type { Document } from "../types.js";
import { text } from "./_helpers.js";

export interface PreviewDeps {
	documents: Documents;
	config: Config;
	assets: AssetsService;
	browserPool: BrowserPool;
	documentRenderer: SettlingDocumentRenderer;
	collectionCursors: Pick<CollectionCursors, "resolve">;
}

function safeFilename(name: string): string {
	return name.replace(/[/\\:*?"<>|]/g, "_");
}

const ActionSchema = z.enum(["open", "snapshot", "show"]);

const MaketPreviewSchema = z.object({
	action: ActionSchema.describe(
		"Operation to run. See the tool description for the action table.",
	),
	doc: z
		.string()
		.optional()
		.describe("Document name. Required for snapshot and show."),
	page: z
		.number()
		.optional()
		.describe("1-based page number. Required for snapshot."),
	pages: ReaderPagesSchema.optional().describe(
		'For show: "all" (default), a page number, a range such as "3-5", or a list of page numbers.',
	),
	layout: ReaderLayoutSchema.optional().describe(
		"For show: scroll (default) shows the pages one after another; page shows one at a time with previous and next.",
	),
	start: z
		.number()
		.int()
		.optional()
		.describe(
			"For show: the page number to open at, one of the shown pages (default: the first).",
		),
	zoom: ReaderZoomSchema.optional().describe(
		"For show: fit-width (default) or actual size.",
	),
	path: z
		.string()
		.optional()
		.describe(
			"For snapshot: output PNG path. Defaults to EXPORTS_DIR/<doc>.png.",
		),
});

const DESCRIPTION = [
	"When to use: view documents outside the agent. `open` flips the live preview URL into the user's browser; `snapshot` rasterises a single page to PNG at its true mm size; `show` puts pages in front of the user inside the conversation.",
	"",
	"  open     — launch the live preview URL (localhost) in the default browser. No params.",
	"  snapshot — render a page via headless Chromium. Returns the full-size PNG as a file path on disk, the page's reading path in Maket, and the image inline (at most 1600 px on its longest side and 1 MB of base64, downscaled when larger; beyond a 2:1 ratio, the top or left part of the page). On hosts that render MCP Apps, the Maket reader also opens on that page.",
	'  show     — on hosts that render MCP Apps, open the Maket reader in the conversation: doc, pages ("all", 3, "3-5" or [1,4]), layout (scroll | page), start (page to open at), zoom (fit-width | actual). The user can then switch layout, jump through the page list, zoom and open the document in Maket. Other hosts get the reading path. Returns no image: use snapshot to inspect a page yourself.',
].join("\n");

export function createMaketPreviewTool(deps: PreviewDeps): ToolHandler {
	const {
		documents,
		config,
		assets,
		browserPool,
		documentRenderer,
		collectionCursors,
	} = deps;
	return {
		metadata: {
			name: "maket_preview",
			description: DESCRIPTION,
			schema: MaketPreviewSchema,
			_meta: {
				ui: { resourceUri: MAKET_PAGE_VIEW_URI, visibility: ["model"] },
			},
		},
		handler: async (rawArgs) => {
			const args = MaketPreviewSchema.parse(rawArgs);
			if (args.action === "open") return runOpen(config);
			if (args.action === "show") return runShow(args, { documents, config });
			return runSnapshot(args, {
				documents,
				config,
				assets,
				documentRenderer,
				collectionCursors,
				browserPool,
			});
		},
	};
}

type Args = z.infer<typeof MaketPreviewSchema>;

async function runOpen(config: Config): Promise<CallToolResult> {
	const previewUrl = `http://localhost:${config.PORT}`;
	const { execFile } = await import("node:child_process");
	const { platform } = await import("node:os");
	const cmd =
		platform() === "darwin"
			? "open"
			: platform() === "win32"
				? "start"
				: "xdg-open";
	execFile(cmd, [previewUrl]);
	return text(`Opened ${previewUrl} in browser`);
}

function renderSnapshotDocument(
	document: Document,
	{
		documentRenderer,
		collectionCursors,
	}: Pick<PreviewDeps, "documentRenderer" | "collectionCursors">,
): Promise<Document> {
	return renderDocumentSettled(documentRenderer, document, {
		collection: cursorRenderOptions(document, (docName, pageIndex) =>
			collectionCursors.resolve(docName, pageIndex),
		),
	});
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Snapshot is an adapter workflow that coordinates document resolution, preview rendering, filesystem output, and MCP response shaping.
async function runSnapshot(
	args: Args,
	deps: PreviewDeps,
): Promise<CallToolResult> {
	const {
		documents,
		config,
		assets,
		documentRenderer,
		collectionCursors,
		browserPool,
	} = deps;
	if (!args.doc) return text("doc is required for action=snapshot", true);
	if (args.page == null)
		return text("page is required for action=snapshot", true);
	const d = documents.resolveOrLoad(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	const rendered = await renderSnapshotDocument(d, {
		documentRenderer,
		collectionCursors,
	});
	const pageIdx = args.page - 1;
	const page = rendered.pages[pageIdx];
	if (!page)
		return text(`Page ${args.page} not found (${d.pages.length} pages)`, true);
	const html = page.html;
	if (!html)
		return text(
			"No HTML content on current page — use maket_html set first",
			true,
		);

	const { w, h } = rendered.canvas;
	const inlined = (dpi: number) =>
		inlineImages(html, {
			assetsDir: config.ASSETS_DIR,
			pageMm: { w, h: rendered.canvas.format === "AUTO" ? undefined : h },
			dpi,
			mimeFromExt: (p) => assets.mimeFromExt(p),
		});
	const surfaceOf = (pageHtml: string) =>
		buildRenderSurfaceHtml({
			canvas: rendered.canvas,
			pageHtmls: [pageHtml],
			charteCss: documents.charteCss(rendered),
			surface: { kind: "snapshot" },
		});
	const fullHtml = surfaceOf(await inlined(96));

	const browser = await browserPool.get();
	const p = await browser.newPage();
	try {
		const viewport = await loadSurface(p, rendered.canvas, fullHtml);
		const png = (await p.screenshot({
			type: "png",
			fullPage: false,
		})) as Buffer;
		const requested = args.path ?? `${safeFilename(d.name)}.png`;
		let outPath: string;
		try {
			outPath = resolveSafeOutputPath(requested, config.EXPORTS_DIR);
		} catch (e) {
			return text((e as Error).message, true);
		}
		writeFileSync(outPath, png);
		const frame = inlineFrame(viewport.width, viewport.height);
		const inline = await inlineSnapshot(p, frame, Buffer.from(png)).catch(
			() => null,
		);
		const readingPath = documentReadingPath(d, config.BASE_PATH);
		return snapshotAnswer(png.length, inline, {
			frame,
			outPath,
			label: `"${d.name}" page ${args.page}`,
			readingPath,
			reader: readerOpening(
				d,
				{
					pages: d.pages.map((_, index) => index + 1),
					layout: "page",
					start: args.page,
					zoom: "fit-width",
				},
				{ path: readingPath, origin: readingOrigin(config) },
			),
		});
	} finally {
		await p.close();
	}
}

/** The inline image of a snapshot: the full PNG when it already fits,
 * else the frame drawn by Chromium. */
async function inlineSnapshot(
	page: RenderPage,
	frame: InlineFrame,
	full: Buffer,
): Promise<InlineCapture> {
	if (!frame.cropped && frame.scale === 1 && fitsInline(full))
		return {
			data: full,
			mimeType: "image/png",
			width: frame.width,
			height: frame.height,
		};
	return captureInline(page, frame);
}

/** The snapshot answer: what was rendered and where the full-size PNG is,
 * the reading path, and the inline image when one could be made. The text
 * alone tells a client that shows no image where to see the page. */
function snapshotAnswer(
	fullBytes: number,
	inline: InlineCapture | null,
	target: {
		frame: InlineFrame;
		outPath: string;
		label: string;
		readingPath: string;
		/** What opens the Maket reader of MCP Apps hosts on this page. */
		reader: MaketReaderOpening;
	},
): CallToolResult {
	const full = `the full-size PNG is the saved file ${target.outPath}`;
	return {
		content: [
			{
				type: "text",
				text: [
					`Snapshot of ${target.label} saved: ${target.outPath} (${Math.round(fullBytes / 1024)} KB, full size).`,
					inline
						? inlineImageLine(target.frame, inline, full)
						: `The inline image could not be attached; ${full}.`,
					readingLine(target.readingPath),
				].join("\n"),
			},
			...(inline
				? [
						{
							type: "image" as const,
							data: inline.data.toString("base64"),
							mimeType: inline.mimeType,
						},
					]
				: []),
		],
		structuredContent: { maketReader: target.reader },
	};
}

/** The origin of this Maket server, as the reader's open link uses it. */
function readingOrigin(config: Config): string {
	const host = config.HOST === "0.0.0.0" ? "localhost" : config.HOST;
	return `http://${host}:${config.PORT}`;
}

/** The display a show call asks for, or the reason it names no page. */
function showDisplay(args: Args, pageCount: number): ReaderDisplay | string {
	const pages = selectedPages(args.pages ?? "all", pageCount);
	if (typeof pages === "string") return pages;
	if (args.start != null && !pages.includes(args.start))
		return `start ${args.start} is not one of the shown pages (${pages.join(", ")})`;
	return {
		pages,
		layout: args.layout ?? "scroll",
		start: args.start ?? pages[0] ?? 1,
		zoom: args.zoom ?? "fit-width",
	};
}

function runShow(
	args: Args,
	{ documents, config }: Pick<PreviewDeps, "documents" | "config">,
): CallToolResult {
	if (!args.doc) return text("doc is required for action=show", true);
	const d = documents.resolveOrLoad(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	if (d.pages.length === 0)
		return text(`Document "${d.name}" has no page to show`, true);
	const display = showDisplay(args, d.pages.length);
	if (typeof display === "string") return text(display, true);
	const readingPath = documentReadingPath(d, config.BASE_PATH);
	return {
		content: [{ type: "text", text: showLine(d, display, readingPath) }],
		structuredContent: {
			maketReader: readerOpening(d, display, {
				path: readingPath,
				origin: readingOrigin(config),
			}),
		},
	};
}

/** What a show call put in front of the user, and where to read it. */
function showLine(
	d: Document,
	display: ReaderDisplay,
	readingPath: string,
): string {
	const shown =
		display.pages.length === d.pages.length
			? `all ${d.pages.length} pages`
			: `page${display.pages.length > 1 ? "s" : ""} ${display.pages.join(", ")}`;
	const layout =
		display.layout === "page"
			? "one page at a time"
			: "pages one after another";
	return [
		`Showing ${shown} of "${d.name}" in the Maket reader (${layout}, opening at page ${display.start}, ${display.zoom}). Hosts that render MCP Apps show it in the conversation.`,
		readingLine(readingPath),
	].join("\n");
}

export const previewPack: ToolPack = {
	id: "preview",
	name: "Preview",
	requires: [
		"documents",
		"config",
		"assets",
		"documentRenderer",
		"collectionCursors",
		"browserPool",
	],
	declaresTools: ["maket_preview"],
	register(container) {
		container.register({
			maketPreviewTool: asFunction(createMaketPreviewTool).singleton(),
		});
	},
};
