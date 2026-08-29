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
import { escapeCssValue } from "../lib/css-escape.js";
import {
	createMermaidDiagramSpec,
	mermaidSpecAttribute,
	renderMermaidDiagram,
} from "../lib/mermaid-document.js";
import {
	MERMAID_TOKEN_ROLES,
	type MermaidRenderingInput,
} from "../lib/mermaid-rendering.js";
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

const MermaidTokenRefsSchema = z
	.object(
		Object.fromEntries(
			MERMAID_TOKEN_ROLES.map((role) => [
				role,
				z
					.string()
					.optional()
					.describe(`Charte token reference for ${role}, as "group.key".`),
			]),
		) as Record<
			(typeof MERMAID_TOKEN_ROLES)[number],
			z.ZodOptional<z.ZodString>
		>,
	)
	.strict();

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
			"Optional built-in diagram profile. Overrides automatic charte defaults; tokenRefs and direct values override it.",
		),
	tokenRefs: MermaidTokenRefsSchema.optional().describe(
		'Explicit references to tokens on the document charte, keyed by diagram role. Example: {"bg":"color.paper","accent":"color.primary","font":"font.body"}.',
	),
	bg: z
		.string()
		.optional()
		.describe(
			"Safe background colour. Overrides charte, profile, or tokenRefs.",
		),
	fg: z
		.string()
		.optional()
		.describe(
			"Safe foreground colour. Overrides charte, profile, or tokenRefs.",
		),
	line: z
		.string()
		.optional()
		.describe(
			"Safe connector colour. Overrides charte, profile, or tokenRefs.",
		),
	accent: z
		.string()
		.optional()
		.describe(
			"Safe arrow/accent colour. Overrides charte, profile, or tokenRefs.",
		),
	muted: z
		.string()
		.optional()
		.describe(
			"Secondary text colour. Overrides charte, profile, or tokenRefs.",
		),
	surface: z
		.string()
		.optional()
		.describe("Node surface colour. Overrides charte, profile, or tokenRefs."),
	border: z
		.string()
		.optional()
		.describe(
			"Node and group border colour. Overrides charte, profile, or tokenRefs.",
		),
	font: z
		.string()
		.optional()
		.describe(
			"Safe primary font family. A fallback stack is normalized to its first family. Overrides charte, profile, or tokenRefs.",
		),
	transparent: z
		.boolean()
		.optional()
		.describe("Render without an SVG background. Default: false."),
	padding: z
		.number()
		.min(0)
		.max(1000)
		.optional()
		.describe("Flowchart/state canvas padding in px."),
	nodeSpacing: z
		.number()
		.min(0)
		.max(1000)
		.optional()
		.describe(
			"Flowchart/state horizontal spacing between sibling nodes in px.",
		),
	layerSpacing: z
		.number()
		.min(0)
		.max(1000)
		.optional()
		.describe("Flowchart/state vertical spacing between diagram layers in px."),
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
	"Renders Mermaid syntax to durable inline SVG and injects it into the page HTML. The source and semantic rendering choices stay on the wrapper so charte changes can rerender the diagram. The diagram scales with its wrapper (width/height drive the frame, not the SVG itself). If dataId already exists, the diagram is replaced in place — idempotent edits.",
	"A document charte is applied automatically through canonical diagram tokens and documented color/font fallbacks. tokenRefs selects any existing charte token explicitly; direct safe values take final precedence.",
	"Density controls are supported for flowchart and state diagrams by the current renderer. Source-level Mermaid styling directives are rejected; use charte tokens or safe diagram options.",
	"Header on its own line:  graph TD\\n  A-->B    (NOT graph TD; A-->B)",
].join("\n");

function cssEscape(s: string): string {
	return s.replace(/["\\]/g, "\\$&");
}

function escapeHtmlAttribute(s: string): string {
	return s.replace(
		/[&"<>]/g,
		(character) =>
			({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[character] ??
			character,
	);
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

	const spec = createMermaidDiagramSpec(args.code, renderingInput(args));
	const rendered = await renderMermaid(spec, deps.documents.charte(doc));
	if (typeof rendered !== "string") return rendered;
	const result = insertMermaidSvg(page.html, args, rendered, spec);
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

async function renderMermaid(
	spec: ReturnType<typeof createMermaidDiagramSpec>,
	charte: ReturnType<Documents["charte"]>,
) {
	try {
		return renderMermaidDiagram(spec, charte);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return text(`Mermaid render failed: ${msg}`, true);
	}
}

function insertMermaidSvg(
	html: string,
	args: z.infer<typeof MermaidSchema>,
	svg: string,
	spec: ReturnType<typeof createMermaidDiagramSpec>,
) {
	const existingIds = [...html.matchAll(/data-id=["']([^"']+)["']/g)].map(
		(match) => match[1] ?? "",
	);
	const dataId = args.dataId || generateId(existingIds);
	const wrapper = createMermaidWrapper(dataId, args, svg, spec);
	const { document } = parseHTML(`<html><body>${html}</body></html>`);
	const root = document.body;
	insertMermaidWrapper(root, dataId, args, wrapper);
	const addressableIds = Array.from(root.querySelectorAll("[data-id]"))
		.filter((el) => !el.closest("svg"))
		.map((el) => el.getAttribute("data-id") ?? "")
		.filter(Boolean);
	return { html: root.innerHTML, dataId, addressableIds };
}

function createMermaidWrapper(
	dataId: string,
	args: z.infer<typeof MermaidSchema>,
	svg: string,
	spec: ReturnType<typeof createMermaidDiagramSpec>,
): string {
	const styleParts: string[] = ["overflow:hidden"];
	if (args.width) styleParts.push(`width:${escapeCssValue(args.width)}`);
	if (args.height) styleParts.push(`height:${escapeCssValue(args.height)}`);
	return `<div data-id="${escapeHtmlAttribute(dataId)}" ${mermaidSpecAttribute(spec)} style="${escapeHtmlAttribute(styleParts.join(";"))}">${svg}</div>`;
}

function renderingInput(
	args: z.infer<typeof MermaidSchema>,
): MermaidRenderingInput {
	return {
		theme: args.theme,
		tokenRefs: args.tokenRefs,
		bg: args.bg,
		fg: args.fg,
		line: args.line,
		accent: args.accent,
		muted: args.muted,
		surface: args.surface,
		border: args.border,
		font: args.font,
		transparent: args.transparent,
		padding: args.padding,
		nodeSpacing: args.nodeSpacing,
		layerSpacing: args.layerSpacing,
	};
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
