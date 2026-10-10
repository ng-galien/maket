/**
 * documents pack — maket_doc (compound).
 *
 * Persistent document-lifecycle verbs: new, list, lookup, link, delete, duplicate, rename,
 * meta (absorbed from the old chartes pack), pin/unpin, export/import (.maket bundles).
 * Session-scoped operations (focus, state, lock) live in maket_workspace.
 *
 * Deps: `documents` (cache + persist), `bus` (document:* + toast events),
 * `store` (document metadata), `config` (EXPORTS_DIR), and shared bundle
 * import/export services.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { normalizeCategoryPath } from "@maket/shared";
import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import { decodeBundle, MAKET_BUNDLE_EXT } from "../lib/maket-format.js";
import { resolveSafeOutputPath } from "../lib/safe-output-path.js";
import type { BundleExportService } from "../services/bundle-export.js";
import type {
	BundleImportResult,
	BundleImportService,
} from "../services/bundle-import.js";
import type { Bus } from "../services/bus.js";
import type { Config } from "../services/config.js";
import type { Documents } from "../services/documents.js";
import type { Store } from "../services/store.js";
import {
	computeCanvasDims,
	createDocument,
	type Document,
	type Page,
} from "../types.js";
import { lockGuard, text } from "./_helpers.js";

export interface DocumentsDeps {
	documents: Documents;
	bus: Bus;
	store: Store;
	config: Config;
	bundleExportService: BundleExportService;
	bundleImportService: BundleImportService;
}

const ActionSchema = z.enum([
	"new",
	"list",
	"lookup",
	"link",
	"delete",
	"duplicate",
	"rename",
	"meta",
	"pin",
	"unpin",
	"export",
	"import",
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
			"The doc in scope. Required for every action except list. For lookup: the exact name to read. For new: the new doc's name (must be unique). For delete/meta/pin/unpin: the doc to act on. For duplicate/rename: the source doc.",
		),
	name: z
		.string()
		.optional()
		.describe(
			"The new name. Only used by duplicate (clone's name) and rename (new name).",
		),
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
			"For new/meta: category path separated by / (for example clients/acme). Flat values remain valid roots; default general.",
		),
	charte: z
		.string()
		.optional()
		.describe(
			"For new/meta: name of an existing charte to associate with this document. The charte itself is applied later via maket_charte view.",
		),
	margins: z
		.object({
			top: z.number(),
			right: z.number(),
			bottom: z.number(),
			left: z.number(),
		})
		.optional()
		.describe(
			"For new: per-side safe-zone insets in mm {top, right, bottom, left}. Optional.",
		),
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
	docs: z
		.array(z.string())
		.optional()
		.describe(
			"For export: list of doc names to include in the bundle. Omit to export all documents. Ignored by other actions.",
		),
	output: z
		.string()
		.optional()
		.describe(
			"For export: output filename (defaults to <doc>.maket or maket-bundle.maket). Absolute paths are honoured; bare names land in EXPORTS_DIR.",
		),
	input: z
		.string()
		.optional()
		.describe(
			"For import: absolute or EXPORTS_DIR-relative path to a .maket file to load.",
		),
	include_assets: z
		.boolean()
		.optional()
		.describe(
			"For export: embed referenced asset binaries (images, SVGs) in the bundle. Default true — produces a portable .maket that survives transfer to another machine or datadir. Set false for a structure-only snapshot (smaller, git-friendly).",
		),
});

const DESCRIPTION = [
	"When to use: every persistent document-lifecycle operation — create, clone, rename, delete, list, update metadata, or move bundles in/out. For session-level actions (open a doc/page in the preview, inspect state, lock), use maket_workspace. For per-page edits use maket_page and for content use maket_html.",
	"",
	"`doc` is the doc in scope for every action except list. `name` only appears when you need a NEW name (duplicate, rename).",
	"",
	"Manage design documents (the workspace unit: canvas + pages + meta).",
	"  new       — create a blank document at `doc`; sets it active. Previous unsaved work is lost.",
	"  list      — enumerate saved documents: pinned documents first (most recently pinned first, marked 📌, with their category), then the other documents as a hierarchy of category paths.",
	"  lookup    — read-only identity of `doc` by exact name, Workspace documents included: JSON {name, id, revision (monotonic modification token), pageCount, dataModel, stateRevision (null without state)}. It never opens the preview nor changes the active document. When absent, the error lists near matches.",
	"  link      — return a reading path for `doc`, using its stable document id and configured browser base path. Prefix it with the reachable gateway origin.",
	"  delete    — remove `doc` permanently; refused if it's the only document left.",
	"  duplicate — clone `doc` → `name` (format variants, A/B copies).",
	"  rename    — rename `doc` → `name`.",
	"  meta      — update `doc`'s metadata: designNotes, teamNotes, rating, category, charte.",
	"  pin       — pin `doc` at the top of the document lists (desktop library, Reader navigation, list). The most recently pinned document comes first; pinning an already pinned doc keeps its place. Allowed on locked documents.",
	"  unpin     — remove `doc`'s pin; it returns to its category.",
	"  export    — write a portable `.maket` bundle to EXPORTS_DIR. By default the bundle embeds referenced asset binaries (images, SVGs) so it survives transfer to another machine or a fresh datadir. Pass `include_assets=false` for a lighter structure-only snapshot. Include `doc` for a single document, `docs` for a list, or omit both to export every document. Referenced chartes, collections, and current document-state snapshots (with their revision retention) are embedded automatically; revision history stays local. Override the filename with `output`.",
	"  import    — load a `.maket` bundle from `input` (absolute path or EXPORTS_DIR-relative). Documents land with conflict-renamed names; chartes and collections skip names that already exist. Current document-state snapshots initialize revision 1, and assets are restored to ASSETS_DIR with the existing collision rule.",
].join("\n");

function totalElementCount(pages: Page[]): number {
	return pages.reduce(
		(n, p) =>
			n + (p.html ? (p.html.match(/data-id="[^"]+"/g) || []).length : 0),
		0,
	);
}

export function createMaketDocTool(deps: DocumentsDeps): ToolHandler {
	const {
		documents,
		bus,
		store,
		config,
		bundleExportService,
		bundleImportService,
	} = deps;
	return {
		metadata: {
			name: "maket_doc",
			description: DESCRIPTION,
			schema: MaketDocSchema,
		},
		handler: (rawArgs) =>
			handleMaketDocTool(rawArgs, {
				documents,
				bus,
				store,
				config,
				bundleExportService,
				bundleImportService,
			}),
	};
}

type Args = z.infer<typeof MaketDocSchema>;

interface MaketDocToolDeps {
	documents: Documents;
	bus: Bus;
	store: Store;
	config: Config;
	bundleExportService: BundleExportService;
	bundleImportService: BundleImportService;
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP handlers are adapter boundaries: they parse the tool contract and route to document workflows without taking ownership from services.
async function handleMaketDocTool(rawArgs: unknown, deps: MaketDocToolDeps) {
	const args = MaketDocSchema.parse(rawArgs);
	switch (args.action) {
		case "new":
			return runNew(args, deps.documents, deps.bus);
		case "list":
			return runList(deps.documents);
		case "lookup":
			return runLookup(args, deps.documents, deps.store);
		case "link":
			return runLink(args, deps.documents, deps.config);
		case "delete":
			return runDelete(args, deps.documents, deps.bus);
		case "duplicate":
			return runDuplicate(args, deps.documents, deps.bus);
		case "rename":
			return runRename(args, deps.documents, deps.bus);
		case "meta":
			return runMeta(args, deps.documents, deps.bus);
		case "pin":
		case "unpin":
			return runPin(args, deps.documents, deps.bus, args.action === "pin");
		case "export":
			return runExport(args, deps.config, deps.bundleExportService);
		case "import":
			return runImport(args, deps.config, deps.bundleImportService);
	}
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP tool action `runNew`: edge adapter over services/store/bus, not domain ownership.
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
			margins: args.margins,
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
		key: "toast_document_created",
		params: { doc: String(args.doc), format: fmt, orientation: orient },
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

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP tool action `runList`: edge adapter over services/store/bus, not domain ownership.
function runList(documents: Documents) {
	const list = documents.list();
	if (!list.length) return text("No documents.");
	const pinned = pinnedDocuments(list);
	const others = list.filter((document) => !document.pinnedAt);
	const lines: string[] = [];
	if (pinned.length > 0) {
		lines.push(`pinned (${pinned.length})`);
		for (const document of pinned) {
			lines.push(
				`  - 📌 ${documentLine(document)} · ${normalizeCategoryPath(document.category)}`,
			);
		}
	}
	lines.push(...renderDocumentCategoryTree(buildDocumentCategoryTree(others)));
	return text(lines.join("\n"));
}

/** Pinned documents, most recently pinned first; equal stamps fall back to name. */
function pinnedDocuments(list: ListedDocument[]): ListedDocument[] {
	return list
		.filter((document) => document.pinnedAt)
		.sort(
			(a, b) =>
				(b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? "") ||
				a.name.localeCompare(b.name),
		);
}

function documentLine(document: ListedDocument): string {
	const stars = document.rating ? ` ${"★".repeat(document.rating)}` : "";
	const charte = document.charte ? ` [${document.charte}]` : "";
	return `${document.name} (${document.format} ${document.orientation}, ${document.count} el.)${stars}${charte}`;
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP tool action `runPin`: edge adapter over the documents service and the propagation event.
function runPin(args: Args, documents: Documents, bus: Bus, pinned: boolean) {
	const action = pinned ? "pin" : "unpin";
	if (!args.doc) return text(`doc is required for action=${action}`, true);
	const d = documents.resolve(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	if (d.meta.structuredWorkspace) {
		return text(
			`Document "${d.name}" belongs to Workspace "${d.meta.structuredWorkspace.workspaceId}" and cannot be pinned.`,
			true,
		);
	}
	if (Boolean(d.pinnedAt) === pinned) {
		return text(
			pinned ? `"${d.name}" is already pinned` : `"${d.name}" is not pinned`,
		);
	}
	const updated = pinned ? documents.pin(d.name) : documents.unpin(d.name);
	if (!updated) return text(`Document "${args.doc}" not found`, true);
	bus.emit("document:pinned", {
		docName: updated.name,
		pinnedAt: updated.pinnedAt,
	});
	return text(
		pinned
			? `Pinned "${updated.name}" at the top of the document list`
			: `Unpinned "${updated.name}"`,
		{ next: ["maket_doc action=list"] },
	);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP tool action `runLookup`: read-only edge adapter over documents and store, not domain ownership.
function runLookup(args: Args, documents: Documents, store: Store) {
	if (!args.doc) return text("doc is required for action=lookup", true);
	const timestamps = store.listTimestamps();
	const doc = documents.resolveOrLoad(args.doc);
	if (!doc) {
		const near = nearDocumentNames(args.doc, [...timestamps.keys()]);
		return text(
			near.length
				? `Document "${args.doc}" not found. Near matches: ${near.map((name) => `"${name}"`).join(", ")}.`
				: `Document "${args.doc}" not found. No near match.`,
			{
				isError: true,
				next: near.map((name) => `maket_doc action=lookup doc=${name}`),
			},
		);
	}
	return text(
		JSON.stringify({
			name: doc.name,
			id: doc.id,
			revision: timestamps.get(doc.name) ?? null,
			pageCount: doc.pages.length,
			dataModel: doc.dataModel,
			stateRevision:
				doc.dataModel === "state"
					? (store.loadCurrentDocumentState(doc.id)?.revision ?? null)
					: null,
		}),
	);
}

const NEAR_MATCH_LIMIT = 5;

function nearDocumentNames(query: string, names: string[]): string[] {
	const wanted = comparableName(query);
	return names
		.map((name) => {
			const candidate = comparableName(name);
			const distance =
				candidate === wanted
					? 0
					: candidate.includes(wanted) || wanted.includes(candidate)
						? 1
						: editDistance(wanted, candidate);
			return { name, distance };
		})
		.filter(
			({ distance }) => distance <= Math.max(2, Math.floor(wanted.length / 4)),
		)
		.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
		.slice(0, NEAR_MATCH_LIMIT)
		.map(({ name }) => name);
}

function comparableName(name: string): string {
	return name
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

function editDistance(left: string, right: string): number {
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let row = 1; row <= left.length; row += 1) {
		const current = [row];
		for (let column = 1; column <= right.length; column += 1) {
			current[column] = Math.min(
				(previous[column] ?? 0) + 1,
				(current[column - 1] ?? 0) + 1,
				(previous[column - 1] ?? 0) +
					(left[row - 1] === right[column - 1] ? 0 : 1),
			);
		}
		previous = current;
	}
	return previous[right.length] ?? 0;
}

function runLink(args: Args, documents: Documents, config: Config) {
	if (!args.doc) return text("doc is required for action=link", true);
	const doc = documents.resolveOrLoad(args.doc);
	if (!doc) return text(`Document "${args.doc}" not found`, true);
	const path = `${config.BASE_PATH ?? ""}/documents/${encodeURIComponent(doc.id)}/read`;
	const owner = doc.meta?.structuredWorkspace;
	const query = owner
		? `?workspace=${encodeURIComponent(owner.workspaceId)}${
				owner.role !== "template"
					? `&collection=${encodeURIComponent(owner.collectionId)}`
					: ""
			}`
		: "";
	return text(JSON.stringify({ documentId: doc.id, path: `${path}${query}` }));
}

type ListedDocument = ReturnType<Documents["list"]>[number];

interface DocumentCategoryNode {
	segment: string;
	path: string;
	documents: ListedDocument[];
	children: Map<string, DocumentCategoryNode>;
}

function buildDocumentCategoryTree(list: ListedDocument[]) {
	const roots = new Map<string, DocumentCategoryNode>();
	for (const document of list) {
		const segments = normalizeCategoryPath(document.category).split("/");
		let siblings = roots;
		let path = "";
		for (const segment of segments) {
			path = path ? `${path}/${segment}` : segment;
			let node = siblings.get(segment);
			if (!node) {
				node = { segment, path, documents: [], children: new Map() };
				siblings.set(segment, node);
			}
			siblings = node.children;
			if (path === normalizeCategoryPath(document.category)) {
				node.documents.push(document);
			}
		}
	}
	return roots;
}

function renderDocumentCategoryTree(
	nodes: Map<string, DocumentCategoryNode>,
	depth = 0,
): string[] {
	const lines: string[] = [];
	for (const node of [...nodes.values()].sort((a, b) =>
		a.segment.localeCompare(b.segment),
	)) {
		const indent = "  ".repeat(depth);
		lines.push(`${indent}${node.segment} (${documentCategoryCount(node)})`);
		for (const document of [...node.documents].sort((a, b) =>
			a.name.localeCompare(b.name),
		)) {
			lines.push(`${indent}  - ${documentLine(document)}`);
		}
		lines.push(...renderDocumentCategoryTree(node.children, depth + 1));
	}
	return lines;
}

function documentCategoryCount(node: DocumentCategoryNode): number {
	let count = node.documents.length;
	for (const child of node.children.values()) {
		count += documentCategoryCount(child);
	}
	return count;
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP tool action `runDelete`: edge adapter over services/store/bus, not domain ownership.
function runDelete(args: Args, documents: Documents, bus: Bus) {
	if (!args.doc) return text("doc is required for action=delete", true);
	const all = documents.all();
	const d = all.get(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	if (all.size <= 1) return text("Cannot delete the only document", true);
	const locked = lockGuard(d);
	if (locked) return locked;
	const structuredWorkspaceGuard = structuredWorkspaceDocumentGuard(d);
	if (structuredWorkspaceGuard) return structuredWorkspaceGuard;
	documents.delete(args.doc);
	bus.emit("document:deleted", { docName: args.doc });
	bus.emit("toast", {
		key: "toast_document_deleted",
		params: { doc: String(args.doc) },
		level: "info",
	});
	return text(`Deleted "${args.doc}"`);
}

function structuredWorkspaceDocumentGuard(d: Document) {
	const owner = d.meta.structuredWorkspace;
	if (!owner) return null;
	const message =
		owner.role !== "template"
			? `Document "${d.name}" is a Workspace collection projection and cannot be deleted independently.`
			: owner.role === "template"
				? `Document "${d.name}" is a Workspace template and cannot be deleted independently.`
				: `Document "${d.name}" is a Workspace item and must be deleted through maket_structured_workspace action=delete_item.`;
	return text(message, true);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP tool action `runDuplicate`: edge adapter over services/store/bus, not domain ownership.
function runDuplicate(args: Args, documents: Documents, bus: Bus) {
	if (!args.doc) return text("doc is required for action=duplicate", true);
	if (!args.name) return text("name is required for action=duplicate", true);
	const sourceDoc = documents.resolve(args.doc);
	if (!sourceDoc) return text(`Document "${args.doc}" not found`, true);
	if (sourceDoc.dataModel === "state") {
		return text(
			"State-backed documents cannot be duplicated until state history is included in document cloning.",
			true,
		);
	}
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
		key: "toast_document_cloned",
		params: { doc: String(args.doc), clone: clone.name },
		level: "success",
	});
	return text(
		`Cloned "${args.doc}" → "${clone.name}" (${totalElementCount(clone.pages)} elements)${cloneCharte}`,
	);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP metadata dispatch is an edge adapter over document ownership, persistence,
// and the server-authored propagation event.
function runMeta(args: Args, documents: Documents, bus: Bus) {
	if (!args.doc) return text("doc is required for action=meta", true);
	const d = documents.resolve(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	if (d.meta.structuredWorkspace) {
		return text(
			`Document "${d.name}" belongs to Workspace "${d.meta.structuredWorkspace.workspaceId}" and cannot be changed through maket_doc.`,
			true,
		);
	}
	const locked = lockGuard(d);
	if (locked) return locked;
	if (!d.meta) d.meta = {};
	if (args.designNotes != null) d.meta.designNotes = args.designNotes;
	if (args.teamNotes != null) d.meta.teamNotes = args.teamNotes;
	if (args.rating != null)
		d.meta.rating = Math.max(0, Math.min(5, Number(args.rating) || 0));
	if (args.category != null) d.category = normalizeCategoryPath(args.category);
	if (args.charte != null) d.meta.charte = args.charte || undefined;
	documents.persist(d.name);
	bus.emit("meta:updated", { docName: d.name });
	return text(
		`Meta updated: category=${d.category}, rating=${d.meta.rating || 0}/5, charte=${d.meta.charte || "none"}, designNotes=${(d.meta.designNotes || "").length}c, teamNotes=${(d.meta.teamNotes || "").length}c`,
	);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP tool action `runRename`: edge adapter over services/store/bus, not domain ownership.
function runRename(args: Args, documents: Documents, bus: Bus) {
	if (!args.doc) return text("doc is required for action=rename", true);
	if (!args.name) return text("name is required for action=rename", true);
	const d = documents.resolve(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	if (d.meta.structuredWorkspace) {
		return text(
			`Document "${d.name}" belongs to Workspace "${d.meta.structuredWorkspace.workspaceId}" and cannot be renamed independently.`,
			true,
		);
	}
	const locked = lockGuard(d);
	if (locked) return locked;
	if (documents.all().has(args.name))
		return text(`Document "${args.name}" already exists`, true);
	const oldName = d.name;
	documents.rename(oldName, args.name);
	bus.emit("document:renamed", { oldName, docName: args.name });
	bus.emit("toast", {
		key: "toast_document_renamed",
		params: { from: oldName, to: String(args.name) },
		level: "success",
	});
	return text(`Renamed "${oldName}" → "${args.name}"`);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Export is an MCP adapter that writes the bundle produced by BundleExportService.
async function runExport(
	args: Args,
	config: Config,
	bundleExportService: BundleExportService,
) {
	const names =
		args.docs && args.docs.length > 0
			? args.docs
			: args.doc
				? [args.doc]
				: undefined;
	const result = await bundleExportService.build({
		names,
		includeAssets: args.include_assets !== false,
	});
	if (!result.ok) return text(result.message, true);

	const filename = args.output
		? args.output.endsWith(MAKET_BUNDLE_EXT)
			? args.output
			: `${args.output}${MAKET_BUNDLE_EXT}`
		: result.filename;
	let outPath: string;
	try {
		outPath = resolveSafeOutputPath(filename, config.EXPORTS_DIR);
	} catch (e) {
		return text((e as Error).message, true);
	}
	writeFileSync(outPath, result.buffer);

	const docLabel =
		result.documents
			.slice(0, 3)
			.map((d) => d.name)
			.join(", ") +
		(result.documents.length > 3 ? `, +${result.documents.length - 3}` : "");
	const charteLabel = result.chartes.length
		? ` + ${result.chartes.length} charte(s)`
		: "";
	let assetReport =
		result.assets.length > 0 ? ` + ${result.assets.length} asset(s)` : "";
	if (result.missingAssets.length > 0) {
		assetReport += ` (${result.missingAssets.length} missing: ${result.missingAssets.slice(0, 3).join(", ")}${result.missingAssets.length > 3 ? "…" : ""})`;
	}
	return text(
		`Exported ${result.documents.length} document(s)${charteLabel}${assetReport} → ${outPath} (${Math.round(result.buffer.length / 1024)} KB)\n  ${docLabel}`,
	);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Import is an MCP adapter that reads a bundle and reports the shared restoration result.
async function runImport(
	args: Args,
	config: Config,
	bundleImportService: BundleImportService,
) {
	if (!args.input) return text("input is required for action=import", true);
	const resolved = isAbsolute(args.input)
		? args.input
		: resolve(join(config.EXPORTS_DIR, args.input));

	let buf: Buffer;
	try {
		buf = readFileSync(resolved);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return text(`Could not read "${resolved}": ${msg}`, true);
	}

	let bundle: Awaited<ReturnType<typeof decodeBundle>>;
	try {
		bundle = await decodeBundle(buf);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return text(msg, true);
	}

	let imported: BundleImportResult;
	try {
		imported = bundleImportService.restore(bundle);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return text(`Could not import bundle: ${msg}`, true);
	}

	const lines: string[] = [];
	lines.push(
		`Imported from ${resolved} (bundle v${imported.version}, exported ${imported.exportedAt || "unknown"})`,
	);
	lines.push(`Documents: ${imported.documents.join(", ") || "(none)"}`);
	if (imported.renamed.length) {
		lines.push(
			`  renamed: ${imported.renamed.map(({ from, to }) => `${from} → ${to}`).join(", ")}`,
		);
	}
	if (imported.chartesAdded.length) {
		lines.push(`Chartes added: ${imported.chartesAdded.join(", ")}`);
	}
	if (imported.chartesSkipped.length) {
		lines.push(
			`Chartes skipped (already exist): ${imported.chartesSkipped.join(", ")}`,
		);
	}
	if (imported.collectionsAdded.length) {
		lines.push(`Collections added: ${imported.collectionsAdded.join(", ")}`);
	}
	if (imported.collectionsSkipped.length) {
		lines.push(
			`Collections skipped (already exist): ${imported.collectionsSkipped.join(", ")}`,
		);
	}
	if (imported.statesImported > 0) {
		lines.push(`Document states: ${imported.statesImported} initialized`);
	}
	if (imported.structuredWorkspacesImported.length > 0) {
		lines.push(
			`Structured Workspaces: ${imported.structuredWorkspacesImported.join(", ")}`,
		);
	}
	if (bundle.assets.length > 0) {
		const parts = [`Assets: ${imported.assetsWritten} written`];
		if (imported.assetsSkipped) {
			parts.push(`${imported.assetsSkipped} skipped (already present)`);
		}
		if (imported.assetsRejected.length) {
			parts.push(`${imported.assetsRejected.length} rejected (unsafe path)`);
		}
		lines.push(parts.join(", "));
	}
	return text(lines.join("\n"));
}

export const documentsPack: ToolPack = {
	id: "documents",
	name: "Documents",
	requires: [
		"documents",
		"bus",
		"store",
		"config",
		"bundleExportService",
		"bundleImportService",
	],
	declaresTools: ["maket_doc"],
	register(container) {
		container.register({
			maketDocTool: asFunction(createMaketDocTool).singleton(),
		});
	},
};
