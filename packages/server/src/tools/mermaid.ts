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
		handler: async (rawArgs) => {
			const args = MermaidSchema.parse(rawArgs);

			const doc = documents.resolve(args.doc);
			if (!doc) return text(`Document "${args.doc}" not found`, true);
			const locked = lockGuard(doc);
			if (locked) return locked;

			const pageIdx = args.page - 1;
			const page = doc.pages[pageIdx];
			if (!page)
				return text(
					`Page ${args.page} not found (${doc.pages.length} pages)`,
					true,
				);
			if (!page.html) page.html = "";

			// Render SVG via beautiful-mermaid (lazy import — avoids paying the cost
			// on every server boot when mermaid isn't used).
			let svg: string;
			try {
				const { renderMermaidSVG, THEMES } = await import("beautiful-mermaid");
				let themeObj: Record<string, string> | undefined;
				if (args.theme && args.theme in THEMES) {
					// beautiful-mermaid's `DiagramColors` type is structural but not indexable;
					// cast through `unknown` so we can pass a mutable copy plus our overrides.
					const base = (
						THEMES as unknown as Record<string, Record<string, string>>
					)[args.theme];
					themeObj = { ...base };
				}
				if (args.bg || args.fg || args.line || args.accent) {
					themeObj = themeObj || {};
					if (args.bg) themeObj.bg = args.bg;
					if (args.fg) themeObj.fg = args.fg;
					if (args.line) themeObj.line = args.line;
					if (args.accent) themeObj.accent = args.accent;
				}
				svg = renderMermaidSVG(args.code, themeObj);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				return text(`Mermaid render failed: ${msg}`, true);
			}

			// Pick a dataId that doesn't clash with existing data-ids on the page
			const existingIds = [
				...page.html.matchAll(/data-id=["']([^"']+)["']/g),
			].map((m) => m[1] ?? "");
			const dataId = args.dataId || generateId(existingIds);

			// Strip fixed width/height from the SVG so it scales with its container
			svg = svg
				.replace(/<svg([^>]*)\swidth="[^"]*"/, '<svg$1 width="100%"')
				.replace(/<svg([^>]*)\sheight="[^"]*"/, '<svg$1 height="100%"');

			const styleParts: string[] = ["overflow:hidden"];
			if (args.width) styleParts.push(`width:${args.width}`);
			if (args.height) styleParts.push(`height:${args.height}`);
			const wrapper = `<div data-id="${dataId}" style="${styleParts.join(";")}">${svg}</div>`;

			// Inject into page HTML
			const { document } = parseHTML(`<html><body>${page.html}</body></html>`);
			const root = document.body;

			const existing = root.querySelector(`[data-id="${cssEscape(dataId)}"]`);
			if (existing) {
				existing.outerHTML = wrapper;
			} else if (args.targetId) {
				const target = root.querySelector(
					`[data-id="${cssEscape(args.targetId)}"]`,
				);
				const pos = args.position || "beforeend";
				if (target) {
					target.insertAdjacentHTML(pos, wrapper);
				} else {
					root.insertAdjacentHTML("beforeend", wrapper);
				}
			} else {
				root.insertAdjacentHTML("beforeend", wrapper);
			}

			// stripActiveHtml on the way out — beautiful-mermaid is trusted but
			// the surrounding page may already contain agent content; keep one
			// pass on every persistence path.
			page.html = stripActiveHtml(root.innerHTML);
			documents.persist(doc.name);

			// Surface every page-level data-id that an agent can target with
			// maket_html patch. Exclude data-ids that live *inside* an SVG — those
			// are mermaid's internal node auto-labels (`A`, `B`, …) and patching
			// them makes no sense.
			const addressableIds = Array.from(root.querySelectorAll("[data-id]"))
				.filter((el) => !el.closest("svg"))
				.map((el) => el.getAttribute("data-id") ?? "")
				.filter(Boolean);

			bus.emit("element:updated", { docName: doc.name, id: "html" });

			return text(
				`Mermaid diagram injected as "${dataId}"\npage data-ids (${addressableIds.length}): ${addressableIds.join(", ")}`,
			);
		},
	};
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
