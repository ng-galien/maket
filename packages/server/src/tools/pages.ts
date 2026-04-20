/**
 * pages pack — maket_page (compound).
 *
 * A single tool dispatches every page-structure verb. Page content lives in
 * HTML and is edited via maket_html; this tool only handles structure.
 *
 * Deps: `documents` (resolve + persist), `bus` (document:loaded — the client
 * re-fetches the doc tree after structural changes).
 */

import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import type { Bus } from "../services/bus.js";
import type { Documents } from "../services/documents.js";
import type { Document, Page } from "../types.js";
import { lockGuard, text } from "./_helpers.js";
import { normalizeImageSrc } from "./html.js";

export interface PagesDeps {
	documents: Documents;
	bus: Bus;
}

const ActionSchema = z.enum(["add", "remove", "rename", "reorder", "list"]);

const MaketPageSchema = z.object({
	action: ActionSchema.describe(
		"Operation to run. See the tool description for the action table.",
	),
	doc: z.string().describe("Document name (always required)."),
	page: z
		.union([z.string(), z.number()])
		.optional()
		.describe(
			"For remove/rename: target page — either 1-based index or page name.",
		),
	name: z
		.string()
		.optional()
		.describe("For add/rename: page name (new page name, or rename target)."),
	html: z
		.string()
		.optional()
		.describe(
			"For add: HTML body for the new page. Relative image src values are normalized to /assets/...",
		),
	from: z.number().optional().describe("For reorder: source 1-based position."),
	to: z.number().optional().describe("For reorder: target 1-based position."),
});

const DESCRIPTION = [
	"When to use: manage page structure within a document — add, remove, rename, reorder, list. For page content, use maket_html instead.",
	"",
	"Manage pages within a document (structure only, not content).",
	"  add     — append a new page with initial HTML; sets it active.",
	"  remove  — delete a page by 1-based index or name; refused if it's the last page.",
	"  rename  — rename a page by index or current name.",
	"  reorder — move a page from one 1-based position to another; activePage adjusts.",
	"  list    — list pages with element counts; the active page is marked ●.",
	"",
	"Note: charte compliance (token-literal colours, font-family, box-shadow) is enforced by maket_html set/patch, not by maket_page add. If the new page must match a charte, follow maket_page add with maket_html set to validate.",
].join("\n");

function pageElementCount(page: Page): number {
	return page.html ? (page.html.match(/data-id="[^"]+"/g) || []).length : 0;
}

function resolvePageIndex(d: Document, pageArg: unknown): number {
	if (typeof pageArg === "number") return Math.round(pageArg) - 1;
	if (typeof pageArg === "string") {
		const asNum = Number(pageArg);
		if (!Number.isNaN(asNum) && asNum >= 1) return Math.round(asNum) - 1;
		return d.pages.findIndex((p) => p.name === pageArg);
	}
	return -1;
}

export function createMaketPageTool(deps: PagesDeps): ToolHandler {
	const { documents, bus } = deps;
	return {
		metadata: {
			name: "maket_page",
			description: DESCRIPTION,
			schema: MaketPageSchema,
		},
		handler: async (rawArgs) => {
			const args = MaketPageSchema.parse(rawArgs);
			const d = documents.resolve(args.doc);
			if (!d) return text(`Document "${args.doc}" not found`, true);
			if (args.action !== "list") {
				const locked = lockGuard(d);
				if (locked) return locked;
			}
			switch (args.action) {
				case "add":
					return runAdd(args, d, documents, bus);
				case "remove":
					return runRemove(args, d, documents, bus);
				case "rename":
					return runRename(args, d, documents, bus);
				case "reorder":
					return runReorder(args, d, documents, bus);
				case "list":
					return runList(d);
			}
		},
	};
}

type Args = z.infer<typeof MaketPageSchema>;

function runAdd(args: Args, d: Document, documents: Documents, bus: Bus) {
	if (!args.name) return text("name is required for action=add", true);
	if (args.html == null) return text("html is required for action=add", true);
	const page: Page = {
		name: args.name,
		elements: [],
		html: normalizeImageSrc(args.html),
	};
	d.pages.push(page);
	d.activePage = d.pages.length - 1;
	documents.persist(d.name);
	const count = (args.html.match(/data-id=/g) || []).length;
	bus.emit("document:loaded", { docName: d.name });
	return text(
		`Added page "${args.name}" (${d.pages.length} pages total, page ${d.pages.length}) — ${count} elements`,
	);
}

function runRemove(args: Args, d: Document, documents: Documents, bus: Bus) {
	if (args.page == null)
		return text("page is required for action=remove", true);
	if (d.pages.length <= 1) return text("Cannot remove the last page", true);
	const idx = resolvePageIndex(d, args.page);
	if (idx < 0 || idx >= d.pages.length)
		return text(
			`Page "${args.page}" not found or out of range (1-${d.pages.length})`,
			true,
		);
	const removed = d.pages.splice(idx, 1)[0];
	if (d.activePage >= d.pages.length) d.activePage = d.pages.length - 1;
	documents.persist(d.name);
	bus.emit("document:loaded", { docName: d.name });
	return text(
		`Removed page "${removed?.name || "Untitled"}" (${d.pages.length} pages remaining)`,
	);
}

function runRename(args: Args, d: Document, documents: Documents, bus: Bus) {
	if (args.page == null)
		return text("page is required for action=rename", true);
	if (!args.name) return text("name is required for action=rename", true);
	const idx = resolvePageIndex(d, args.page);
	if (idx < 0 || idx >= d.pages.length)
		return text(`Page "${args.page}" not found or out of range`, true);
	const pg = d.pages[idx];
	if (!pg) return text(`Page "${args.page}" not found`, true);
	const oldName = pg.name || "Untitled";
	pg.name = args.name;
	documents.persist(d.name);
	bus.emit("document:loaded", { docName: d.name });
	return text(`Page ${idx + 1} renamed: "${oldName}" → "${args.name}"`);
}

function runReorder(args: Args, d: Document, documents: Documents, bus: Bus) {
	if (args.from == null || args.to == null)
		return text("from and to are required for action=reorder", true);
	const from = Math.round(Number(args.from)) - 1;
	const to = Math.round(Number(args.to)) - 1;
	if (from < 0 || from >= d.pages.length)
		return text(`Source page ${args.from} out of range`, true);
	if (to < 0 || to >= d.pages.length)
		return text(`Target position ${args.to} out of range`, true);
	const [movedPage] = d.pages.splice(from, 1);
	if (!movedPage) return text("Page not found", true);
	d.pages.splice(to, 0, movedPage);
	documents.persist(d.name);
	if (d.activePage === from) {
		d.activePage = to;
	} else if (from < d.activePage && to >= d.activePage) {
		d.activePage--;
	} else if (from > d.activePage && to <= d.activePage) {
		d.activePage++;
	}
	bus.emit("document:loaded", { docName: d.name });
	return text(
		`Page "${movedPage.name || "Untitled"}" moved from position ${from + 1} to ${to + 1}`,
	);
}

function runList(d: Document) {
	const lines = d.pages.map((p, i) => {
		const active = i === d.activePage ? " ●" : "";
		const count = pageElementCount(p);
		return `  ${i + 1}. ${p.name || "Untitled"} (${count} elements)${active}`;
	});
	return text(`${d.pages.length} pages:\n${lines.join("\n")}`);
}

export const pagesPack: ToolPack = {
	id: "pages",
	name: "Pages",
	requires: ["documents", "bus"],
	declaresTools: ["maket_page"],
	register(container) {
		container.register({
			maketPageTool: asFunction(createMaketPageTool).singleton(),
		});
	},
};
