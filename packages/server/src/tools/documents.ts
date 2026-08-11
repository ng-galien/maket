/**
 * documents pack — maket_doc (compound).
 *
 * Persistent document-lifecycle verbs: new, list, delete, duplicate, rename,
 * meta (absorbed from the old chartes pack), export/import (.maket bundles).
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
import { computeCanvasDims, createDocument, type Page } from "../types.js";
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
	"  export    — write a portable `.maket` bundle to EXPORTS_DIR. By default the bundle embeds referenced asset binaries (images, SVGs) so it survives transfer to another machine or a fresh datadir. Pass `include_assets=false` for a lighter structure-only snapshot. Include `doc` for a single document, `docs` for a list, or omit both to export every document. Referenced chartes, collections, and current document-state snapshots are embedded automatically; revision history stays local. Override the filename with `output`.",
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
			return runDelete(args, deps.documents, deps.bus);
		case "duplicate":
			return runDuplicate(args, deps.documents, deps.bus);
		case "rename":
			return runRename(args, deps.documents, deps.bus);
		case "meta":
			return runMeta(args, deps.documents, deps.bus);
		case "export":
			return runExport(args, deps.config, deps.bundleExportService);
		case "import":
			return runImport(args, deps.config, deps.bundleImportService);
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
	documents.rename(oldName, args.name);
	bus.emit("document:loaded", { docName: args.name });
	bus.emit("toast", {
		text: `"${oldName}" → "${args.name}"`,
		level: "success",
	});
	return text(`Renamed "${oldName}" → "${args.name}"`);
}

// code-moniker: ignore[smell-feature-envy-local]
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

// code-moniker: ignore[smell-feature-envy-local]
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
