/**
 * mermaid plugin — render Mermaid diagrams to SVG and inject them into a page.
 *
 * The SVG becomes part of the page HTML (not an external asset), so the
 * diagram is visible in the live preview and embedded in PDF exports.
 * Deps: `documents` (resolve + persist), `bus` (emit element:updated).
 */

import { asFunction } from "awilix";
import { parseHTML } from "linkedom";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import { stripActiveHtml } from "../lib/strip-active-html.js";
import type { Bus } from "../services/bus.js";
import type { Documents } from "../services/documents.js";
import { lockGuard, text } from "./_helpers.js";

export interface MermaidDeps {
	documents: Documents;
	bus: Bus;
}

const MERMAID_THEMES = [
	"zinc-light",
	"zinc-dark",
	"tokyo-night",
	"tokyo-night-storm",
	"tokyo-night-light",
	"catppuccin-mocha",
	"catppuccin-latte",
	"nord",
	"nord-light",
	"dracula",
	"github-light",
	"github-dark",
	"solarized-light",
	"solarized-dark",
	"one-dark",
] as const;

const MermaidSchema = z.object({
	doc: z.string().describe("Document name"),
	page: z.number().describe("Page number (1-based)"),
	code: z
		.string()
		.describe(
			'Mermaid diagram syntax. Header on its own line, then statements. E.g. "graph TD\\n  A-->B\\n  B-->C".',
		),
	dataId: z
		.string()
		.optional()
		.describe(
			"data-id for the wrapper element. Default: auto-generated (mermaid-1, mermaid-2...)",
		),
	width: z
		.string()
		.optional()
		.describe(
			'CSS width for the wrapper (e.g. "180mm", "100%"). Default: auto.',
		),
	height: z
		.string()
		.optional()
		.describe('CSS height for the wrapper (e.g. "120mm"). Default: auto.'),
	theme: z
		.enum(MERMAID_THEMES)
		.optional()
		.describe(
			"Built-in theme name. Can be combined with custom color overrides.",
		),
	bg: z
		.string()
		.optional()
		.describe("Background color (hex). Overrides theme bg."),
	fg: z
		.string()
		.optional()
		.describe("Text/foreground color (hex). Overrides theme fg."),
	line: z
		.string()
		.optional()
		.describe("Line/connection color (hex). Overrides theme line."),
	accent: z
		.string()
		.optional()
		.describe("Arrow/accent color (hex). Overrides theme accent."),
	targetId: z
		.string()
		.optional()
		.describe("data-id of parent element to insert into. Default: page root."),
	position: z
		.enum(["beforebegin", "afterbegin", "beforeend", "afterend"])
		.optional()
		.describe("Where to insert relative to target. Default: beforeend."),
});

const DESCRIPTION = [
	"When to use: add a diagram to a page. Works for flowcharts, sequence, class, ER, state, and XY chart diagrams. Pick this over manual SVG or nested divs when the thing you want is conceptually a graph.",
	"",
	"Renders Mermaid syntax to SVG and injects it into the page HTML. The diagram scales with its wrapper (width/height drive the frame, not the SVG itself). If dataId already exists, the diagram is replaced in place — idempotent edits.",
	"Header on its own line:  graph TD\\n  A-->B    (NOT graph TD; A-->B)",
].join("\n");

function cssEscape(s: string): string {
	return s.replace(/["\\]/g, "\\$&");
}

function generateId(existingIds: string[]): string {
	let n = 1;
	while (existingIds.includes(`mermaid-${n}`)) n++;
	return `mermaid-${n}`;
}

export function createMaketMermaidTool(deps: MermaidDeps): ToolHandler {
	const { documents, bus } = deps;

	return {
		metadata: {
			name: "maket_mermaid",
			description: DESCRIPTION,
			schema: MermaidSchema,
		},
		handler: (rawArgs) => handleMaketMermaidTool(rawArgs, { documents, bus }),
	};
}

interface MermaidToolDeps {
	documents: Documents;
	bus: Bus;
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP Mermaid insertion is an adapter workflow over rendering, HTML parsing, document persistence, and bus notification.
async function handleMaketMermaidTool(rawArgs: unknown, deps: MermaidToolDeps) {
	const args = MermaidSchema.parse(rawArgs);
	const doc = deps.documents.resolve(args.doc);
	if (!doc) return text(`Document "${args.doc}" not found`, true);
	const locked = lockGuard(doc);
	if (locked) return locked;

	const pageIdx = args.page - 1;
	const page = doc.pages[pageIdx];
	if (!page) {
		return text(
			`Page ${args.page} not found (${doc.pages.length} pages)`,
			true,
		);
	}
	if (!page.html) page.html = "";

	const rendered = await renderMermaid(args);
	if (typeof rendered !== "string") return rendered;
	const result = insertMermaidSvg(page.html, args, rendered);
	page.html = stripActiveHtml(result.html);
	try {
		deps.documents.persist(doc.name);
	} catch (error) {
		return text(error instanceof Error ? error.message : String(error), true);
	}
	deps.bus.emit("element:updated", { docName: doc.name, id: "html" });
	return text(
		`Mermaid diagram injected as "${result.dataId}"\npage data-ids (${result.addressableIds.length}): ${result.addressableIds.join(", ")}`,
	);
}

async function renderMermaid(args: z.infer<typeof MermaidSchema>) {
	try {
		const { renderMermaidSVG, THEMES } = await import("beautiful-mermaid");
		const themeObj = buildMermaidTheme(args, THEMES);
		return renderMermaidSVG(args.code, themeObj);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return text(`Mermaid render failed: ${msg}`, true);
	}
}

function buildMermaidTheme(
	args: z.infer<typeof MermaidSchema>,
	themes: unknown,
): Record<string, string> | undefined {
	let themeObj: Record<string, string> | undefined;
	if (args.theme && args.theme in (themes as Record<string, unknown>)) {
		const base = (themes as Record<string, Record<string, string>>)[args.theme];
		themeObj = { ...base };
	}
	if (args.bg || args.fg || args.line || args.accent) {
		themeObj = themeObj || {};
		if (args.bg) themeObj.bg = args.bg;
		if (args.fg) themeObj.fg = args.fg;
		if (args.line) themeObj.line = args.line;
		if (args.accent) themeObj.accent = args.accent;
	}
	return themeObj;
}

function insertMermaidSvg(
	html: string,
	args: z.infer<typeof MermaidSchema>,
	svg: string,
) {
	const existingIds = [...html.matchAll(/data-id=["']([^"']+)["']/g)].map(
		(match) => match[1] ?? "",
	);
	const dataId = args.dataId || generateId(existingIds);
	const wrapper = createMermaidWrapper(dataId, args, normalizeMermaidSvg(svg));
	const { document } = parseHTML(`<html><body>${html}</body></html>`);
	const root = document.body;
	insertMermaidWrapper(root, dataId, args, wrapper);
	const addressableIds = Array.from(root.querySelectorAll("[data-id]"))
		.filter((el) => !el.closest("svg"))
		.map((el) => el.getAttribute("data-id") ?? "")
		.filter(Boolean);
	return { html: root.innerHTML, dataId, addressableIds };
}

function normalizeMermaidSvg(svg: string): string {
	return svg
		.replace(/<svg([^>]*)\swidth="[^"]*"/, '<svg$1 width="100%"')
		.replace(/<svg([^>]*)\sheight="[^"]*"/, '<svg$1 height="100%"');
}

function createMermaidWrapper(
	dataId: string,
	args: z.infer<typeof MermaidSchema>,
	svg: string,
): string {
	const styleParts: string[] = ["overflow:hidden"];
	if (args.width) styleParts.push(`width:${args.width}`);
	if (args.height) styleParts.push(`height:${args.height}`);
	return `<div data-id="${dataId}" style="${styleParts.join(";")}">${svg}</div>`;
}

function insertMermaidWrapper(
	root: HTMLElement,
	dataId: string,
	args: z.infer<typeof MermaidSchema>,
	wrapper: string,
) {
	const existing = root.querySelector(`[data-id="${cssEscape(dataId)}"]`);
	if (existing) {
		existing.outerHTML = wrapper;
		return;
	}
	if (!args.targetId) {
		root.insertAdjacentHTML("beforeend", wrapper);
		return;
	}
	const target = root.querySelector(`[data-id="${cssEscape(args.targetId)}"]`);
	target?.insertAdjacentHTML(args.position || "beforeend", wrapper);
	if (!target) root.insertAdjacentHTML("beforeend", wrapper);
}

export const mermaidPack: ToolPack = {
	id: "mermaid",
	name: "Mermaid diagrams",
	requires: ["documents", "bus"],
	declaresTools: ["maket_mermaid"],
	register(container) {
		container.register({
			maketMermaidTool: asFunction(createMaketMermaidTool).singleton(),
		});
	},
};
