/**
 * The Maket reader on MCP Apps hosts: the view `ui://maket/page` is the
 * client's read-only reader built into one HTML file. A tool result opens it
 * with `structuredContent.maketReader`: the mode, the table of the document
 * and the display settings. The reader then fetches each page and each image
 * through the app-only tool `maket_reader`, every answer under
 * {@link MAKET_READER_MAX_ANSWER} characters.
 */

import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Canvas, Document } from "../types.js";

export const MAKET_PAGE_VIEW_URI = "ui://maket/page";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
/** Hosts of the charte fonts the reader may load. */
export const MAKET_PAGE_VIEW_FONT_HOSTS = [
	"https://fonts.googleapis.com",
	"https://fonts.gstatic.com",
	"https://fonts.bunny.net",
] as const;
/** The largest answer of `maket_reader`, in characters of serialized JSON. */
export const MAKET_READER_MAX_ANSWER = 100_000;
/** File name of the built reader under the MCP views directory. */
export const MAKET_READER_VIEW_FILE = "maket-reader.html";

export const ReaderPagesSchema = z
	.union([
		z.literal("all"),
		z.number().int(),
		z.string().regex(/^\d+\s*-\s*\d+$/),
		z.array(z.number().int()).min(1),
	])
	.describe(
		'Pages to show: "all", a page number, a range such as "3-5", or a list of page numbers.',
	);
export const ReaderLayoutSchema = z
	.enum(["scroll", "page"])
	.describe(
		"scroll shows the pages one after another; page shows one page at a time with previous and next.",
	);
export const ReaderZoomSchema = z
	.enum(["fit-width", "actual"])
	.describe(
		"fit-width fits the page to the view width; actual shows it at its real size.",
	);

export type ReaderPages = z.infer<typeof ReaderPagesSchema>;
export type ReaderLayout = z.infer<typeof ReaderLayoutSchema>;
export type ReaderZoom = z.infer<typeof ReaderZoomSchema>;

export interface ReaderDisplay {
	/** 1-based page numbers shown, in order. */
	pages: number[];
	layout: ReaderLayout;
	/** 1-based page number the reader opens at, one of `pages`. */
	start: number;
	zoom: ReaderZoom;
}

/** What opens the reader: the mode, the table of the document and the
 * display settings. Only the document mode exists; another mode is another
 * member of this union read by the same view. */
export interface MaketReaderOpening {
	mode: "document";
	document: {
		id: string;
		name: string;
		category: string;
		canvas: Canvas;
		pageCount: number;
		pages: { number: number; name: string }[];
	};
	display: ReaderDisplay;
	/** Path of the document in Maket, relative to the Maket origin. */
	readingPath: string;
	/** The same page in Maket as a full URL, for the reader's open link. */
	readingUrl: string;
}

/** The page numbers named by `pages`, or the reason they name none. */
export function selectedPages(
	pages: ReaderPages,
	pageCount: number,
): number[] | string {
	const inRange = (n: number) => n >= 1 && n <= pageCount;
	const outside = `the document has ${pageCount} page${pageCount === 1 ? "" : "s"}`;
	if (pages === "all")
		return Array.from({ length: pageCount }, (_, i) => i + 1);
	if (typeof pages === "number")
		return inRange(pages) ? [pages] : `Page ${pages} not found: ${outside}`;
	if (typeof pages === "string") {
		const [from = 0, to = 0] = pages
			.split("-")
			.map((part) => Number(part.trim()));
		if (from > to) return `Range ${pages} runs backwards`;
		if (!inRange(from) || !inRange(to))
			return `Range ${pages} is outside the document: ${outside}`;
		return Array.from({ length: to - from + 1 }, (_, i) => from + i);
	}
	const missing = pages.filter((n) => !inRange(n));
	if (missing.length)
		return `Page${missing.length > 1 ? "s" : ""} ${missing.join(", ")} not found: ${outside}`;
	return [...new Set(pages)];
}

export function readerOpening(
	document: Document,
	display: ReaderDisplay,
	reading: { path: string; origin: string },
): MaketReaderOpening {
	return {
		mode: "document",
		document: {
			id: document.id,
			name: document.name,
			category: document.category,
			canvas: document.canvas,
			pageCount: document.pages.length,
			pages: document.pages.map((page, index) => ({
				number: index + 1,
				name: page.name ?? `${index + 1}`,
			})),
		},
		display,
		readingPath: reading.path,
		readingUrl: `${reading.origin}${reading.path}`,
	};
}

const ASSET_REF =
	/\/assets\/(?:(?:thumb|preview|print)\/)?([^"')\s?#]+\.(?:jpg|jpeg|png|webp|svg|gif))/gi;

/** The asset files an HTML or CSS text references, each once. */
export function referencedAssets(...texts: string[]): string[] {
	const files = new Set<string>();
	for (const text of texts)
		for (const match of text.matchAll(ASSET_REF)) {
			const file = safeDecode(match[1] ?? "");
			if (file && !file.includes("..") && !file.startsWith("/"))
				files.add(file);
		}
	return [...files];
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** Whether a whole tool answer fits the reader's bound. */
export function answerFits(result: CallToolResult): boolean {
	return JSON.stringify(result).length <= MAKET_READER_MAX_ANSWER;
}

/** Room for the data URL of one image inside an answer. */
const IMAGE_ROOM = MAKET_READER_MAX_ANSWER - 4_000;

export interface ReaderImage {
	dataUrl: string;
	width: number;
	height: number;
}

/** One asset as a data URL at most `width` pixels wide, smaller still until
 * it fits an answer; null when the file is missing or cannot fit. */
export async function readerImage(
	assetsDir: string,
	file: string,
	width: number,
): Promise<ReaderImage | null> {
	const path = join(assetsDir, file);
	if (!existsSync(path)) return null;
	if (extname(file).toLowerCase() === ".svg") {
		const dataUrl = `data:image/svg+xml;base64,${readFileSync(path).toString("base64")}`;
		return dataUrl.length <= IMAGE_ROOM
			? { dataUrl, width: 0, height: 0 }
			: null;
	}
	const { Jimp } = await import("jimp");
	const source = await Jimp.read(path);
	const png = extname(file).toLowerCase() === ".png";
	let target = Math.max(16, Math.min(Math.round(width), source.width));
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const image = source.clone();
		if (image.width > target) image.resize({ w: target });
		const usePng = png && attempt < 2;
		const buffer = usePng
			? await image.getBuffer("image/png")
			: await image.getBuffer("image/jpeg", { quality: 78 });
		const dataUrl = `data:${usePng ? "image/png" : "image/jpeg"};base64,${buffer.toString("base64")}`;
		if (dataUrl.length <= IMAGE_ROOM)
			return { dataUrl, width: image.width, height: image.height };
		if (!usePng || attempt >= 1)
			target = Math.max(16, Math.round(target * 0.75));
	}
	return null;
}

/** The built reader, or a page saying it is not built. */
export function readerViewHtml(viewsDir: string): string {
	const path = join(viewsDir, MAKET_READER_VIEW_FILE);
	if (existsSync(path)) return readFileSync(path, "utf8");
	return `<!doctype html><html><head><meta charset="utf-8"><title>Maket reader</title></head><body style="font:14px system-ui;margin:16px">The Maket reader is not built on this server. Run <code>npm run build:mcp-view</code> in the Maket repository, then reopen the page.</body></html>`;
}
