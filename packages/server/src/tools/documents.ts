/**
 * documents pack — maket_doc (compound).
 *
 * A single tool dispatches every document-lifecycle verb: new, focus, list,
 * delete, duplicate, rename, meta (absorbed from the old chartes pack), and
 * state (absorbed from the old canvas pack).
 *
 * Deps: `documents` (cache + persist), `bus` (document:* + toast events).
 */

import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import type { Bus } from "../services/bus.js";
import type { Documents } from "../services/documents.js";
import { computeCanvasDims, createDocument, type Page } from "../types.js";
import { lockGuard, text } from "./_helpers.js";

export interface DocumentsDeps {
	documents: Documents;
	bus: Bus;
}

const ActionSchema = z.enum([
	"new",
	"focus",
	"list",
	"delete",
	"duplicate",
	"rename",
	"meta",
	"state",
	"lock",
]);

const FormatSchema = z.enum([
	"A2",
	"A3",
	"A4",
	"A5",
	"A6",
	"A7",
	"A8",
	"DESKTOP",
	"TABLET",
	"MOBILE",
]);

const MaketDocSchema = z.object({
	action: ActionSchema.describe(
		"Operation to run. See the tool description for the action table.",
	),
	doc: z
		.string()
		.optional()
		.describe(
			"The doc in scope. Required for every action except list. For new: the new doc's name (must be unique). For delete/focus/meta/state: the doc to act on. For duplicate/rename: the source doc.",
		),
	name: z
		.string()
		.optional()
		.describe(
			"The new name. Only used by duplicate (clone's name) and rename (new name).",
		),
	page: z
		.number()
		.optional()
		.describe("For focus: 1-based page number to make active."),
	format: FormatSchema.optional().describe(
		"For new: paper/screen format. Default A3. Paper sizes are mm; DESKTOP/TABLET/MOBILE are screen aspect ratios scaled to mm.",
	),
	orientation: z
		.enum(["portrait", "landscape"])
		.optional()
		.describe("For new: page orientation. Default portrait."),
	background: z
		.string()
		.optional()
		.describe("For new: canvas background colour (CSS). Default #ffffff."),
	category: z
		.string()
		.optional()
		.describe(
			"For new/meta: category tag used for grouping in list (default general).",
		),
	charte: z
		.string()
		.optional()
		.describe(
			"For new/meta: name of an existing charte to associate with this document. The charte itself is applied later via maket_charte view.",
		),
	textMargin: z
		.number()
		.optional()
		.describe("For new: textual margin in mm. Optional."),
	designNotes: z
		.string()
		.optional()
		.describe("For meta: designer-facing notes (visible in the UI)."),
	teamNotes: z
		.string()
		.optional()
		.describe("For meta: team-facing notes (visible in the UI)."),
	rating: z
		.number()
		.optional()
		.describe("For meta: 0–5 star rating (clamped)."),
	locked: z
		.boolean()
		.optional()
		.describe(
			"For lock: true to lock the document (refuses MCP edits), false to unlock. Omit to toggle.",
		),
});

const DESCRIPTION = [
	"When to use: every document-lifecycle operation — create, open, clone, rename, delete, list, update metadata, or inspect state. Prefer maket_page for per-page edits and maket_html for content changes.",
	"",
	"`doc` is the doc in scope for every action except list. `name` only appears when you need a NEW name (duplicate, rename).",
	"",
	"Manage design documents (the workspace unit: canvas + pages + meta).",
	"  new       — create a blank document at `doc`; sets it active. Previous unsaved work is lost.",
	"  focus     — open `doc` at page `page` in the live preview.",
	"  list      — enumerate saved documents grouped by category.",
	"  delete    — remove `doc` permanently; refused if it's the only document left.",
	"  duplicate — clone `doc` → `name` (format variants, A/B copies).",
	"  rename    — rename `doc` → `name`.",
	"  meta      — update `doc`'s metadata: designNotes, teamNotes, rating, category, charte.",
	"  state     — summarise `doc`'s state: canvas, pages with element counts, charte, pending messages.",
	"  lock      — lock or unlock `doc`. When locked, every doc-scoped mutation (maket_html, maket_page, maket_canvas, maket_mermaid, maket_doc delete/rename/meta) refuses until it's unlocked. Global resources (maket_image, maket_charte) are unaffected — they aren't owned by a single doc. Pass locked=true/false, or omit to toggle.",
].join("\n");

function pageElementCount(page: Page): number {
	return page.html ? (page.html.match(/data-id="[^"]+"/g) || []).length : 0;
}

function totalElementCount(pages: Page[]): number {
	return pages.reduce((n, p) => n + pageElementCount(p), 0);
}

export function createMaketDocTool(deps: DocumentsDeps): ToolHandler {
	const { documents, bus } = deps;
	return {
		metadata: {
			name: "maket_doc",
			description: DESCRIPTION,
			schema: MaketDocSchema,
		},
		handler: async (rawArgs) => {
			const args = MaketDocSchema.parse(rawArgs);
			switch (args.action) {
				case "new":
					return runNew(args, documents, bus);
				case "focus":
					return runFocus(args, documents, bus);
				case "list":
					return runList(documents);
				case "delete":
					return runDelete(args, documents, bus);
				case "duplicate":
					return runDuplicate(args, documents, bus);
				case "rename":
					return runRename(args, documents, bus);
				case "meta":
					return runMeta(args, documents, bus);
				case "state":
					return runState(args, documents);
				case "lock":
					return runLock(args, documents, bus);
			}
		},
	};
}

type Args = z.infer<typeof MaketDocSchema>;

function runNew(args: Args, documents: Documents, bus: Bus) {
	if (!args.doc) return text("doc is required for action=new", true);
	if (documents.all().has(args.doc))
		return text(`Document "${args.doc}" already exists`, true);
	const fmt = args.format || "A3";
	const orient = args.orientation || "portrait";
	const { w, h } = computeCanvasDims(fmt, orient);
	const newDoc = createDocument({
		name: args.doc,
		category: args.category || "general",
		canvas: {
			format: fmt,
			orientation: orient,
			w,
			h,
			bg: args.background || "#ffffff",
			textMargin: args.textMargin,
		},
		meta: { charte: args.charte },
	});
	documents.all().set(args.doc, newDoc);
	documents.persist(args.doc);
	const charteMsg = newDoc.meta.charte
		? `\nCharte: "${newDoc.meta.charte}"`
		: "";
	bus.emit("document:created", { docName: args.doc });
	bus.emit("toast", {
		text: `New document "${args.doc}" (${fmt} ${orient})`,
		level: "success",
	});
	const next = newDoc.meta.charte
		? [
				`maket_charte view name=${newDoc.meta.charte}`,
				`maket_html set doc=${args.doc} page=1 context_token=<from_load>`,
			]
		: [`maket_html set doc=${args.doc} page=1`];
	return text(
		`New doc "${args.doc}" [${newDoc.category}] (${fmt} ${orient} ${w}x${h}mm)${charteMsg}`,
		{ next },
	);
}

function runFocus(args: Args, documents: Documents, bus: Bus) {
	if (!args.doc) return text("doc is required for action=focus", true);
	if (args.page == null) return text("page is required for action=focus", true);
	const d = documents.resolveOrLoad(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	const pageIdx = args.page - 1;
	if (pageIdx < 0 || pageIdx >= d.pages.length)
		return text(`Page ${args.page} not found (${d.pages.length} pages)`, true);
	d.activePage = pageIdx;
	const p = d.pages[pageIdx];
	if (!p) return text(`Page ${args.page} not found`, true);
	const dc = d.canvas;
	const charteName = d.meta?.charte;
	const charteInfo = charteName
		? `\nCharte: "${charteName}" — use maket_charte view to apply brand styles`
		: "\n⚠ No charte associated — use maket_doc meta to set one";
	bus.emit("document:loaded", { docName: d.name });
	return text(
		`Focused "${d.name}" page ${args.page}/${d.pages.length}: "${p.name || "Untitled"}" [${d.category || "general"}] (${dc.format} ${dc.orientation} ${dc.w}x${dc.h}mm, ${pageElementCount(p)} elements)${charteInfo}`,
	);
}

function runList(documents: Documents) {
	const list = documents.list();
	if (!list.length) return text("No documents.");
	const groups = new Map<string, typeof list>();
	for (const d of list) {
		const cat = d.category || "general";
		if (!groups.has(cat)) groups.set(cat, []);
		groups.get(cat)?.push(d);
	}
	const lines: string[] = [];
	for (const [cat, docs] of groups) {
		lines.push(`${cat} (${docs.length})`);
		for (const d of docs) {
			const stars = d.rating ? ` ${"★".repeat(d.rating)}` : "";
			const charte = d.charte ? ` [${d.charte}]` : "";
			lines.push(
				`  - ${d.name} (${d.format} ${d.orientation}, ${d.count} el.)${stars}${charte}`,
			);
		}
	}
	return text(lines.join("\n"));
}

function runDelete(args: Args, documents: Documents, bus: Bus) {
	if (!args.doc) return text("doc is required for action=delete", true);
	const all = documents.all();
	const d = all.get(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	if (all.size <= 1) return text("Cannot delete the only document", true);
	const locked = lockGuard(d);
	if (locked) return locked;
	documents.delete(args.doc);
	bus.emit("document:deleted", { docName: args.doc });
	bus.emit("toast", {
		text: `Document "${args.doc}" deleted`,
		level: "info",
	});
	return text(`Deleted "${args.doc}"`);
}

function runDuplicate(args: Args, documents: Documents, bus: Bus) {
	if (!args.doc) return text("doc is required for action=duplicate", true);
	if (!args.name) return text("name is required for action=duplicate", true);
	const sourceDoc = documents.resolve(args.doc);
	if (!sourceDoc) return text(`Document "${args.doc}" not found`, true);
	if (documents.all().has(args.name))
		return text(`Document "${args.name}" already exists`, true);
	const cloneData = structuredClone({
		name: args.name,
		category: sourceDoc.category,
		canvas: sourceDoc.canvas,
		meta: sourceDoc.meta,
		pages: sourceDoc.pages,
		activePage: sourceDoc.activePage,
		nextId: sourceDoc.nextId,
	});
	if (cloneData.meta) cloneData.meta.locked = false;
	const clone = createDocument(cloneData);
	documents.all().set(clone.name, clone);
	documents.persist(clone.name);
	const cloneCharte = clone.meta?.charte
		? ` [charte: ${clone.meta.charte}]`
		: "";
	bus.emit("document:created", { docName: clone.name });
	bus.emit("toast", {
		text: `Document "${args.doc}" cloned → "${clone.name}"`,
		level: "success",
	});
	return text(
		`Cloned "${args.doc}" → "${clone.name}" (${totalElementCount(clone.pages)} elements)${cloneCharte}`,
	);
}

function runState(args: Args, documents: Documents) {
	if (!args.doc) return text("doc is required for action=state", true);
	const d = documents.resolve(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	const pending = (d._pending || []).length;
	const displayed = d._displayed === true;
	const pageLines = d.pages.map((p, i) => {
		const count = p.html?.match(/data-id="[^"]+"/g)?.length ?? 0;
		return `  ${i + 1}. ${p.name || `Page ${i + 1}`} (${count} el.)`;
	});
	const lines = [
		`Document: "${d.name}" [${d.category}]  ${d.canvas.format} ${d.canvas.orientation} ${d.canvas.w}×${d.canvas.h}mm`,
		displayed
			? ""
			: "⚠ Not displayed in front — use maket_doc focus to open it",
		d.meta?.charte ? `Charte: ${d.meta.charte}` : "⚠ No charte",
		`Pages (${d.pages.length}):`,
		...pageLines,
		pending > 0
			? `📌 ${pending} pending message(s) — use maket_message list`
			: "",
	].filter(Boolean);
	return text(lines.join("\n"));
}

function runMeta(args: Args, documents: Documents, bus: Bus) {
	if (!args.doc) return text("doc is required for action=meta", true);
	const d = documents.resolve(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	const locked = lockGuard(d);
	if (locked) return locked;
	if (!d.meta) d.meta = {};
	if (args.designNotes != null) d.meta.designNotes = args.designNotes;
	if (args.teamNotes != null) d.meta.teamNotes = args.teamNotes;
	if (args.rating != null)
		d.meta.rating = Math.max(0, Math.min(5, Number(args.rating) || 0));
	if (args.category != null) d.category = args.category || "general";
	if (args.charte != null) d.meta.charte = args.charte || undefined;
	bus.emit("meta:updated", { docName: d.name });
	return text(
		`Meta updated: category=${d.category}, rating=${d.meta.rating || 0}/5, charte=${d.meta.charte || "none"}, designNotes=${(d.meta.designNotes || "").length}c, teamNotes=${(d.meta.teamNotes || "").length}c`,
	);
}

function runRename(args: Args, documents: Documents, bus: Bus) {
	if (!args.doc) return text("doc is required for action=rename", true);
	if (!args.name) return text("name is required for action=rename", true);
	const d = documents.resolve(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	const locked = lockGuard(d);
	if (locked) return locked;
	if (documents.all().has(args.name))
		return text(`Document "${args.name}" already exists`, true);
	const oldName = d.name;
	documents.delete(oldName);
	d.name = args.name;
	documents.all().set(args.name, d);
	documents.persist(d.name);
	bus.emit("document:loaded", { docName: args.name });
	bus.emit("toast", {
		text: `"${oldName}" → "${args.name}"`,
		level: "success",
	});
	return text(`Renamed "${oldName}" → "${args.name}"`);
}

function runLock(args: Args, documents: Documents, bus: Bus) {
	if (!args.doc) return text("doc is required for action=lock", true);
	const d = documents.resolve(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	if (!d.meta) d.meta = {};
	const next = args.locked ?? !(d.meta.locked === true);
	d.meta.locked = next;
	documents.persist(d.name);
	bus.emit("meta:updated", { docName: d.name });
	bus.emit("toast", {
		text: next
			? `Document "${d.name}" locked`
			: `Document "${d.name}" unlocked`,
		level: "info",
	});
	return text(
		next
			? `🔒 Locked "${d.name}" — MCP tools will refuse to edit it until unlocked.`
			: `🔓 Unlocked "${d.name}".`,
	);
}

export const documentsPack: ToolPack = {
	id: "documents",
	name: "Documents",
	requires: ["documents", "bus"],
	declaresTools: ["maket_doc"],
	register(container) {
		container.register({
			maketDocTool: asFunction(createMaketDocTool).singleton(),
		});
	},
};
