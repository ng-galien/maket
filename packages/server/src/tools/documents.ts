/**
 * documents pack — maket_doc (compound).
 *
 * Persistent document-lifecycle verbs: new, list, delete, duplicate, rename,
 * meta (absorbed from the old chartes pack), export/import (.maket bundles).
 * Session-scoped operations (focus, state, lock) live in maket_workspace.
 *
 * Deps: `documents` (cache + persist), `bus` (document:* + toast events),
 * `store` (charte read/write for bundle import/export), `config` (EXPORTS_DIR),
 * `pending` (pending-message cleanup on delete).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { normalizeCategoryPath } from "@maket/shared";
import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import {
	collectAssetFilenames,
	loadAssetsFromDir,
} from "../lib/asset-collector.js";
import { writeBundleAssets } from "../lib/asset-writer.js";
import {
	bundleFilename,
	decodeBundle,
	encodeBundleV2,
	MAKET_BUNDLE_EXT,
	uniqueName,
} from "../lib/maket-format.js";
import { resolveSafeOutputPath } from "../lib/safe-output-path.js";
import type { Bus } from "../services/bus.js";
import type { Collections } from "../services/collections.js";
import type { Config } from "../services/config.js";
import type { Documents } from "../services/documents.js";
import type { Pending } from "../services/pending.js";
import type { Store } from "../services/store.js";
import {
	type Charte,
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
	pending: Pending;
	collections: Pick<Collections, "referencedBy">;
}

const ActionSchema = z.enum([
	"new",
	"list",
	"delete",
	"duplicate",
	"rename",
	"meta",
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
			"The doc in scope. Required for every action except list. For new: the new doc's name (must be unique). For delete/meta: the doc to act on. For duplicate/rename: the source doc.",
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
	"  list      — enumerate saved documents as a hierarchy of category paths.",
	"  delete    — remove `doc` permanently; refused if it's the only document left.",
	"  duplicate — clone `doc` → `name` (format variants, A/B copies).",
	"  rename    — rename `doc` → `name`.",
	"  meta      — update `doc`'s metadata: designNotes, teamNotes, rating, category, charte.",
	"  export    — write a portable `.maket` bundle to EXPORTS_DIR. By default the bundle embeds referenced asset binaries (images, SVGs) so it survives transfer to another machine or a fresh datadir. Pass `include_assets=false` for a lighter structure-only snapshot. Include `doc` for a single document, `docs` for a list, or omit both to export every document. Referenced chartes are embedded automatically. Override the filename with `output`.",
	"  import    — load a `.maket` bundle from `input` (absolute path or EXPORTS_DIR-relative). Documents land with conflict-renamed names; chartes skip names that already exist so your current brand isn't overwritten. Assets in the bundle are restored to ASSETS_DIR with the same collision-renaming rule.",
].join("\n");

function totalElementCount(pages: Page[]): number {
	return pages.reduce(
		(n, p) =>
			n + (p.html ? (p.html.match(/data-id="[^"]+"/g) || []).length : 0),
		0,
	);
}

export function createMaketDocTool(deps: DocumentsDeps): ToolHandler {
	const { documents, bus, store, config, pending, collections } = deps;
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
				pending,
				collections,
			}),
	};
}

type Args = z.infer<typeof MaketDocSchema>;

interface MaketDocToolDeps {
	documents: Documents;
	bus: Bus;
	store: Store;
	config: Config;
	pending: Pending;
	collections: Pick<Collections, "referencedBy">;
}

// code-moniker: ignore[smell-feature-envy-local]
// MCP handlers are adapter boundaries: they parse the tool contract and route to document workflows without taking ownership from services.
async function handleMaketDocTool(rawArgs: unknown, deps: MaketDocToolDeps) {
	const args = MaketDocSchema.parse(rawArgs);
	switch (args.action) {
		case "new":
			return runNew(args, deps.documents, deps.bus);
		case "list":
			return runList(deps.documents);
		case "delete":
			return runDelete(args, deps.documents, deps.bus, deps.pending);
		case "duplicate":
			return runDuplicate(args, deps.documents, deps.bus);
		case "rename":
			return runRename(args, deps.documents, deps.bus);
		case "meta":
			return runMeta(args, deps.documents, deps.bus);
		case "export":
			return runExport(
				args,
				deps.documents,
				deps.store,
				deps.config,
				deps.collections,
			);
		case "import":
			return runImport(args, deps.documents, deps.store, deps.bus, deps.config);
	}
}

// code-moniker: ignore[smell-feature-envy-local]
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

// code-moniker: ignore[smell-feature-envy-local]
// MCP tool action `runList`: edge adapter over services/store/bus, not domain ownership.
function runList(documents: Documents) {
	const list = documents.list();
	if (!list.length) return text("No documents.");
	const lines = renderDocumentCategoryTree(buildDocumentCategoryTree(list));
	return text(lines.join("\n"));
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
			const stars = document.rating ? ` ${"★".repeat(document.rating)}` : "";
			const charte = document.charte ? ` [${document.charte}]` : "";
			lines.push(
				`${indent}  - ${document.name} (${document.format} ${document.orientation}, ${document.count} el.)${stars}${charte}`,
			);
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

// code-moniker: ignore[smell-feature-envy-local]
// MCP tool action `runDelete`: edge adapter over services/store/bus, not domain ownership.
function runDelete(
	args: Args,
	documents: Documents,
	bus: Bus,
	pending: Pending,
) {
	if (!args.doc) return text("doc is required for action=delete", true);
	const all = documents.all();
	const d = all.get(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	if (all.size <= 1) return text("Cannot delete the only document", true);
	const locked = lockGuard(d);
	if (locked) return locked;
	documents.delete(args.doc);
	pending.dropDoc(args.doc);
	bus.emit("document:deleted", { docName: args.doc });
	bus.emit("toast", {
		text: `Document "${args.doc}" deleted`,
		level: "info",
	});
	return text(`Deleted "${args.doc}"`);
}

// code-moniker: ignore[smell-feature-envy-local]
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
		text: `Document "${args.doc}" cloned → "${clone.name}"`,
		level: "success",
	});
	return text(
		`Cloned "${args.doc}" → "${clone.name}" (${totalElementCount(clone.pages)} elements)${cloneCharte}`,
	);
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
	if (args.category != null) d.category = normalizeCategoryPath(args.category);
	if (args.charte != null) d.meta.charte = args.charte || undefined;
	bus.emit("meta:updated", { docName: d.name });
	return text(
		`Meta updated: category=${d.category}, rating=${d.meta.rating || 0}/5, charte=${d.meta.charte || "none"}, designNotes=${(d.meta.designNotes || "").length}c, teamNotes=${(d.meta.teamNotes || "").length}c`,
	);
}

// code-moniker: ignore[smell-feature-envy-local]
// MCP tool action `runRename`: edge adapter over services/store/bus, not domain ownership.
function runRename(args: Args, documents: Documents, bus: Bus) {
	if (!args.doc) return text("doc is required for action=rename", true);
	if (!args.name) return text("name is required for action=rename", true);
	const d = documents.resolve(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	if (d.dataModel === "state") {
		return text(
			"State-backed documents cannot be renamed until state identity is preserved by the rename workflow.",
			true,
		);
	}
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

// code-moniker: ignore[smell-feature-envy-local]
// Export is an MCP workflow coordinator that gathers documents, assets, chartes, and config into the portable bundle boundary.
async function runExport(
	args: Args,
	documents: Documents,
	store: Store,
	config: Config,
	collections: Pick<Collections, "referencedBy">,
) {
	const all = documents.all();
	const names: string[] =
		args.docs && args.docs.length > 0
			? args.docs
			: args.doc
				? [args.doc]
				: [...all.keys()];

	if (names.length === 0) return text("No documents to export", true);

	const selected: Document[] = [];
	const missing: string[] = [];
	for (const name of names) {
		const d = documents.resolveOrLoad(name);
		if (!d) missing.push(name);
		else selected.push(d);
	}
	if (missing.length)
		return text(`Documents not found: ${missing.join(", ")}`, true);
	const stateful = selected.filter((doc) => doc.dataModel === "state");
	if (stateful.length > 0) {
		return text(
			`State-backed documents cannot be bundled yet: ${stateful.map((doc) => doc.name).join(", ")}.`,
			true,
		);
	}

	const charteNames = new Set<string>();
	for (const d of selected) if (d.meta?.charte) charteNames.add(d.meta.charte);
	const chartes: Charte[] = [];
	for (const name of charteNames) {
		try {
			const c = store.loadCharte(name);
			if (c) chartes.push(c);
		} catch {}
	}

	const includeAssets = args.include_assets !== false;
	const collectionRefs = collections.referencedBy(selected);
	let buf: Buffer;
	let assetReport = "";
	if (includeAssets) {
		const refs = collectAssetFilenames(selected);
		const { assets, missing: missingAssets } = loadAssetsFromDir(
			refs,
			config.ASSETS_DIR,
		);
		buf = await encodeBundleV2(selected, chartes, collectionRefs, assets);
		assetReport = assets.length > 0 ? ` + ${assets.length} asset(s)` : "";
		if (missingAssets.length > 0) {
			assetReport += ` (${missingAssets.length} missing: ${missingAssets.slice(0, 3).join(", ")}${missingAssets.length > 3 ? "…" : ""})`;
		}
	} else {
		buf = await encodeBundleV2(selected, chartes, collectionRefs, []);
	}

	const defaultName =
		selected.length === 1
			? selected[0]?.name || "maket-bundle"
			: "maket-bundle";
	const filename = args.output
		? args.output.endsWith(MAKET_BUNDLE_EXT)
			? args.output
			: `${args.output}${MAKET_BUNDLE_EXT}`
		: bundleFilename(defaultName);
	let outPath: string;
	try {
		outPath = resolveSafeOutputPath(filename, config.EXPORTS_DIR);
	} catch (e) {
		return text((e as Error).message, true);
	}
	writeFileSync(outPath, buf);

	const docLabel =
		selected
			.slice(0, 3)
			.map((d) => d.name)
			.join(", ") + (selected.length > 3 ? `, +${selected.length - 3}` : "");
	const charteLabel = chartes.length ? ` + ${chartes.length} charte(s)` : "";
	return text(
		`Exported ${selected.length} document(s)${charteLabel}${assetReport} → ${outPath} (${Math.round(buf.length / 1024)} KB)\n  ${docLabel}`,
	);
}

// code-moniker: ignore[smell-feature-envy-local]
// Import is an MCP workflow coordinator that restores bundle data across document, asset, charte, persistence, and event services.
async function runImport(
	args: Args,
	documents: Documents,
	store: Store,
	bus: Bus,
	config: Config,
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

	const importedDocs: string[] = [];
	const renamedDocs: string[] = [];
	const all = documents.all();
	for (const snap of bundle.documents) {
		if (snap.dataModel === "state") {
			return text(
				`Bundle document "${snap.name}" declares state without bundled revisions.`,
				true,
			);
		}
		const finalName = uniqueName(snap.name, (n) => all.has(n));
		const doc = createDocument({
			name: finalName,
			category: snap.category || "general",
			dataModel: snap.dataModel,
			canvas: snap.canvas,
			meta: snap.meta || {},
			pages: snap.pages?.length ? snap.pages : undefined,
			activePage: snap.activePage ?? 0,
			nextId: snap.nextId ?? 1,
		});
		all.set(finalName, doc);
		documents.persist(finalName);
		bus.emit("document:created", { docName: finalName });
		importedDocs.push(finalName);
		if (finalName !== snap.name)
			renamedDocs.push(`${snap.name} → ${finalName}`);
	}

	const importedChartes: string[] = [];
	const skippedChartes: string[] = [];
	for (const c of bundle.chartes) {
		try {
			if (store.loadCharte(c.name)) {
				skippedChartes.push(c.name);
				continue;
			}
			store.saveCharte(c);
			bus.emit("charte:updated", { name: c.name, css: c.css || "" });
			importedChartes.push(c.name);
		} catch {}
	}

	const assetReport = writeBundleAssets(bundle.assets, config.ASSETS_DIR);
	if (assetReport.written > 0) {
		bus.emit("assets:changed", {});
	}

	bus.emit("toast", {
		text: `Imported ${importedDocs.length} document(s)${importedChartes.length ? ` + ${importedChartes.length} charte(s)` : ""}${assetReport.written ? ` + ${assetReport.written} asset(s)` : ""}`,
		level: "success",
	});

	const lines: string[] = [];
	lines.push(
		`Imported from ${resolved} (bundle v${bundle.version}, exported ${bundle.exportedAt || "unknown"})`,
	);
	lines.push(`Documents: ${importedDocs.join(", ") || "(none)"}`);
	if (renamedDocs.length) lines.push(`  renamed: ${renamedDocs.join(", ")}`);
	if (importedChartes.length)
		lines.push(`Chartes added: ${importedChartes.join(", ")}`);
	if (skippedChartes.length)
		lines.push(`Chartes skipped (already exist): ${skippedChartes.join(", ")}`);
	if (bundle.assets.length > 0) {
		const parts = [`Assets: ${assetReport.written} written`];
		if (assetReport.skipped)
			parts.push(`${assetReport.skipped} skipped (already present)`);
		if (assetReport.rejected.length)
			parts.push(`${assetReport.rejected.length} rejected (unsafe path)`);
		lines.push(parts.join(", "));
	}
	return text(lines.join("\n"));
}

export const documentsPack: ToolPack = {
	id: "documents",
	name: "Documents",
	requires: ["documents", "bus", "store", "config", "pending", "collections"],
	declaresTools: ["maket_doc"],
	register(container) {
		container.register({
			maketDocTool: asFunction(createMaketDocTool).singleton(),
		});
	},
};
