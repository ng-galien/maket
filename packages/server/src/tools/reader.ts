/**
 * reader pack — maket_reader, the calls of the Maket reader on MCP Apps
 * hosts. Its visibility is `["app"]`: the host never offers it to the model,
 * only to the view `ui://maket/page` served by this same server.
 *
 *   page  — one rendered page: its HTML with `/assets/` references, the
 *           charte CSS and the list of images it uses.
 *   image — one image of that page, downscaled to the displayed width.
 *   write — one value of a state document, as the Maket form writes it:
 *           lock guard first, then the terminal patch at expectedRevision
 *           (item documents of a Structured Workspace write through their
 *           item source). A stale revision answers the current state.
 *
 * Every answer stays under MAKET_READER_MAX_ANSWER characters; a page above
 * it is refused with its reading path.
 */

import type { DocumentStateClientView } from "@maket/shared";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import { cursorRenderOptions } from "../lib/collection-render.js";
import {
	answerFits,
	MAKET_PAGE_VIEW_URI,
	MAKET_READER_MAX_ANSWER,
	readerImage,
	referencedAssets,
} from "../lib/maket-reader.js";
import { localizedOf } from "../lib/message-error.js";
import { documentReadingPath } from "../lib/reading-link.js";
import { stripActiveHtml } from "../lib/strip-active-html.js";
import type { CollectionCursors } from "../services/collection-cursor.js";
import type { Config } from "../services/config.js";
import type { DocumentRenderer } from "../services/document-renderer.js";
import { renderDocumentSettled } from "../services/document-renderer.js";
import type { DocumentStateMutations } from "../services/document-state-mutations.js";
import type { Documents } from "../services/documents.js";
import type { Document } from "../types.js";
import { json, text } from "./_helpers.js";

export interface ReaderDeps {
	documents: Documents;
	config: Config;
	documentRenderer: Pick<
		DocumentRenderer,
		"render" | "renderSettled" | "stateView"
	>;
	collectionCursors: Pick<CollectionCursors, "resolve">;
	documentStateMutations: Pick<DocumentStateMutations, "patchTerminal">;
}

const MaketReaderSchema = z.object({
	action: z.enum(["page", "image", "write"]).describe("page, image or write."),
	doc: z.string().describe("Document name."),
	page: z
		.number()
		.int()
		.optional()
		.describe("For page and image: 1-based page number."),
	expectedRevision: z
		.number()
		.int()
		.optional()
		.describe("For write: the state revision the value was edited from."),
	path: z.string().optional().describe("For write: JSON Pointer of the value."),
	op: z.enum(["replace", "add"]).optional().describe("For write: patch op."),
	value: z
		.union([z.string(), z.number(), z.boolean(), z.null()])
		.optional()
		.describe("For write: the new value."),
	file: z
		.string()
		.optional()
		.describe("For image: the asset file, one of the page's images."),
	width: z
		.number()
		.optional()
		.describe("For image: displayed width in device pixels."),
});

const DESCRIPTION =
	"Calls of the Maket reader view (ui://maket/page): page returns one rendered page without image data, image returns one of its images downscaled to the displayed width, write sets one value of a state document as the Maket form does. Not for agents.";

export function createMaketReaderTool(deps: ReaderDeps): ToolHandler {
	return {
		metadata: {
			name: "maket_reader",
			description: DESCRIPTION,
			schema: MaketReaderSchema,
			_meta: {
				ui: { resourceUri: MAKET_PAGE_VIEW_URI, visibility: ["app"] },
			},
		},
		handler: async (rawArgs) => {
			const args = MaketReaderSchema.parse(rawArgs);
			const document = deps.documents.resolveOrLoad(args.doc);
			if (!document) return text(`Document "${args.doc}" not found`, true);
			if (args.action === "write") return writeAnswer(document, args, deps);
			return readAnswer(document, args, deps);
		},
	};
}

/** The page or image answer for one page of the document. */
async function readAnswer(
	document: Document,
	args: z.infer<typeof MaketReaderSchema>,
	deps: ReaderDeps,
): Promise<CallToolResult> {
	const page = args.page ?? 0;
	if (page < 1 || page > document.pages.length)
		return text(
			`Page ${args.page ?? ""} not found (${document.pages.length} pages)`,
			true,
		);
	const { html, charteCss } = await renderedPage(document, page, deps);
	if (args.action === "image")
		return imageAnswer(args, referencedAssets(html, charteCss), deps);
	return pageAnswer(
		document,
		page,
		{ html, charteCss, state: stateOf(document, deps) },
		deps,
	);
}

/** One page as Maket renders it (collection cursor, state, flows), its
 * active HTML stripped, and the document's charte CSS. */
async function renderedPage(
	document: Document,
	page: number,
	deps: ReaderDeps,
): Promise<{ html: string; charteCss: string }> {
	const rendered = await renderDocumentSettled(
		deps.documentRenderer,
		document,
		{
			collection: cursorRenderOptions(document, (name, index) =>
				deps.collectionCursors.resolve(name, index),
			),
		},
	);
	return {
		html: stripActiveHtml(rendered.pages[page - 1]?.html ?? ""),
		charteCss: deps.documents.charteCss(rendered),
	};
}

function pageAnswer(
	document: Document,
	page: number,
	content: {
		html: string;
		charteCss: string;
		state: ReaderState | null;
	},
	deps: ReaderDeps,
): CallToolResult {
	const images = referencedAssets(content.html, content.charteCss);
	const answer = json(
		{
			doc: document.name,
			page,
			name: document.pages[page - 1]?.name ?? `${page}`,
			html: content.html,
			charteCss: content.charteCss,
			images,
			form:
				Boolean(document.pages[page - 1]?.jsonForms) ||
				content.html.includes("data-maket-bind"),
			locked: document.meta?.locked === true,
			...(content.state ? { state: content.state } : {}),
		},
		{
			text: `Page ${page} of "${document.name}" for the Maket reader, ${images.length} image${images.length === 1 ? "" : "s"} to load.`,
		},
	);
	if (answerFits(answer)) return answer;
	const readingPath = documentReadingPath(document, deps.config.BASE_PATH);
	return json(
		{ doc: document.name, page, tooLarge: true, readingPath },
		{
			text: `Page ${page} of "${document.name}" is above ${MAKET_READER_MAX_ANSWER} characters; read it in Maket: ${readingPath}`,
		},
	);
}

async function imageAnswer(
	args: z.infer<typeof MaketReaderSchema>,
	images: string[],
	deps: ReaderDeps,
): Promise<CallToolResult> {
	if (!args.file || !images.includes(args.file))
		return text(
			`Image "${args.file ?? ""}" is not on page ${args.page} of "${args.doc}"`,
			true,
		);
	const image = await readerImage(
		deps.config.ASSETS_DIR,
		args.file,
		Math.max(16, Math.min(args.width ?? 1200, 2400)),
	);
	if (!image)
		return text(
			`Image "${args.file}" could not be loaded under ${MAKET_READER_MAX_ANSWER} characters`,
			true,
		);
	return json(
		{ file: args.file, ...image },
		{ text: `Image ${args.file} for the Maket reader.` },
	);
}

/** The state of a state document as the reader binds its controls:
 * schema, data and revision, without the page templates. */
type ReaderState = Omit<DocumentStateClientView, "templates">;

function stateOf(document: Document, deps: ReaderDeps): ReaderState | null {
	if (document.dataModel !== "state") return null;
	const view = deps.documentRenderer.stateView(document);
	if (!view) return null;
	const { templates: _templates, ...state } = view;
	return state;
}

async function writeAnswer(
	document: Document,
	args: z.infer<typeof MaketReaderSchema>,
	deps: ReaderDeps,
): Promise<CallToolResult> {
	if (args.expectedRevision == null || !args.path || args.value === undefined)
		return text(
			"expectedRevision, path and value are required for write",
			true,
		);
	if (document.meta?.locked === true)
		return json(
			{ ok: false, reason: "locked", doc: document.name },
			{
				isError: true,
				text: `Document "${document.name}" is locked: the value was not written.`,
			},
		);
	try {
		const revision = await deps.documentStateMutations.patchTerminal(
			document.name,
			args.expectedRevision,
			{ op: args.op ?? "replace", path: args.path, value: args.value },
		);
		return json(
			{
				ok: true,
				revision: revision.revision,
				state: stateOf(document, deps),
			},
			{
				text: `Wrote ${args.path} of "${document.name}": revision ${revision.revision}.`,
			},
		);
	} catch (error) {
		const message = localizedOf(error);
		const stale = message?.key === "msg_state_revision_conflict";
		return json(
			{
				ok: false,
				reason: stale ? "stale" : "refused",
				message: error instanceof Error ? error.message : String(error),
				state: stateOf(document, deps),
			},
			{
				isError: true,
				text: stale
					? `The state of "${document.name}" changed since revision ${args.expectedRevision}: the current state is returned.`
					: `The value was not written: ${error instanceof Error ? error.message : String(error)}`,
			},
		);
	}
}

export const readerPack: ToolPack = {
	id: "reader",
	name: "Reader",
	requires: [
		"documents",
		"config",
		"documentRenderer",
		"collectionCursors",
		"documentStateMutations",
	],
	declaresTools: ["maket_reader"],
	register(container) {
		container.register({
			maketReaderTool: asFunction(createMaketReaderTool).singleton(),
		});
	},
};
