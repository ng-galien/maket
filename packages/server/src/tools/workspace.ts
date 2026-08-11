/**
 * workspace pack — maket_workspace (compound).
 *
 * Session-level operations against the live workspace: focus a doc/page for
 * the preview, inspect a doc's current state, toggle its lock, and drain the
 * pending user-message queue (element flags, drops, review notes, workspace
 * alerts). Document lifecycle (new/delete/duplicate/rename/meta/export/import)
 * stays in maket_doc — this tool only touches what's in-session.
 *
 * Deps: `documents` (resolve + persist for lock), `bus` (document:loaded,
 * meta:updated, toast), `pending` (queue read + ack).
 */

import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import type { Annotations } from "../services/annotations.js";
import type { Bus } from "../services/bus.js";
import type {
	CollectionCursors,
	CollectionCursorView,
} from "../services/collection-cursor.js";
import type { Documents } from "../services/documents.js";
import type { Page } from "../types.js";
import { text } from "./_helpers.js";

export interface WorkspaceDeps {
	documents: Documents;
	bus: Bus;
	pending: Annotations;
	collectionCursors: CollectionCursors;
}

const ActionSchema = z.enum([
	"focus",
	"state",
	"lock",
	"fit_view",
	"list_messages",
	"ack_messages",
]);

const MaketWorkspaceSchema = z.object({
	action: ActionSchema.describe(
		"Operation to run. See the tool description for the action table.",
	),
	doc: z
		.string()
		.trim()
		.min(1)
		.optional()
		.describe(
			"The document in scope. Required for focus/state/lock. Do not pass it for list_messages; that action returns every queued user message across all documents and the workspace.",
		),
	page: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("For focus: 1-based page number to make active."),
	locked: z
		.boolean()
		.optional()
		.describe(
			"For lock: true to lock the document, false to unlock. Omit to toggle.",
		),
	ids: z
		.array(z.string().trim().min(1))
		.min(1)
		.optional()
		.describe("For ack_messages: message ids to mark processed."),
});

const DESCRIPTION = [
	"When to use: every session-level interaction with the live workspace — open a doc/page in the preview, inspect a doc's current state, toggle its lock, and process the user-message queue. For persistent CRUD on documents (create, rename, delete, duplicate, meta, import/export) use maket_doc.",
	"",
	"  focus         — open `doc` at page `page` in the live preview (sets active doc + active page).",
	"  state         — summarise `doc`'s current state: canvas, pages with element counts and data-source cursors (collection · mode · row), charte, pending messages.",
	"  lock          — lock or unlock `doc`. When locked, every doc-scoped mutation refuses until it's unlocked. Pass locked=true/false, or omit to toggle.",
	"  fit_view      — zoom out the client to fit the whole workspace (same as the Maximize button).",
	"  list_messages — return every pending user message across all docs and the workspace bucket as JSON. Each message carries its own `docName` (or none for workspace scope).",
	"  ack_messages  — drop the given `ids` from whichever bucket they live in.",
].join("\n");

function pageElementCount(page: Page): number {
	return page.html ? (page.html.match(/data-id="[^"]+"/g) || []).length : 0;
}

export function createMaketWorkspaceTool(deps: WorkspaceDeps): ToolHandler {
	const { documents, bus, pending, collectionCursors } = deps;
	return {
		metadata: {
			name: "maket_workspace",
			description: DESCRIPTION,
			schema: MaketWorkspaceSchema,
		},
		handler: async (rawArgs) => {
			const args = MaketWorkspaceSchema.parse(rawArgs);
			switch (args.action) {
				case "focus":
					return runFocus(args, documents, bus);
				case "state":
					return runState(args, documents, pending, collectionCursors);
				case "lock":
					return runLock(args, documents, bus);
				case "fit_view":
					return runFitView(bus);
				case "list_messages":
					return runListMessages(pending);
				case "ack_messages":
					return runAckMessages(args, pending);
			}
		},
	};
}

type Args = z.infer<typeof MaketWorkspaceSchema>;

// code-moniker: ignore[smell-feature-envy-local]
// MCP tool action `runFocus`: edge adapter over services/store/bus, not domain ownership.
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
	bus.emit("document:focused", { docName: d.name });
	return text(
		`Focused "${d.name}" page ${args.page}/${d.pages.length}: "${p.name || "Untitled"}" [${d.category || "general"}] (${dc.format} ${dc.orientation} ${dc.w}x${dc.h}mm, ${pageElementCount(p)} elements)${charteInfo}`,
	);
}

function runState(
	args: Args,
	documents: Documents,
	pending: Annotations,
	collectionCursors: CollectionCursors,
) {
	if (!args.doc) return text("doc is required for action=state", true);
	const d = documents.resolve(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	const pendingCount = pending.forDoc(d.name).length;
	const displayed = d._displayed === true;
	const pageLines = d.pages.map((p, i) => {
		const count = p.html?.match(/data-id="[^"]+"/g)?.length ?? 0;
		const view = p.collection?.name
			? collectionCursors.describe(d.name, i)
			: null;
		const binding = view ? `  ⛁ ${cursorLine(view)}` : "";
		return `  ${i + 1}. ${p.name || `Page ${i + 1}`} (${count} el.)${binding}`;
	});
	const lines = [
		`Document: "${d.name}" [${d.category}]  ${d.canvas.format} ${d.canvas.orientation} ${d.canvas.w}×${d.canvas.h}mm`,
		displayed
			? ""
			: "⚠ Not displayed in front — use maket_workspace focus to open it",
		d.meta?.charte ? `Charte: ${d.meta.charte}` : "⚠ No charte",
		`Pages (${d.pages.length}):`,
		...pageLines,
		pendingCount > 0
			? `📌 ${pendingCount} pending message(s) — use maket_workspace list_messages`
			: "",
	].filter(Boolean);
	return text(lines.join("\n"));
}

function cursorLine(view: CollectionCursorView): string {
	const row =
		view.rowNumber > 0
			? `row ${view.rowNumber}/${view.rowCount}`
			: `${view.rowCount} rows`;
	return `${view.cursor.collection} · ${view.cursor.mode} · ${row}`;
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

function runFitView(bus: Bus) {
	bus.emit("workspace:fit-view", {});
	return text("Workspace fit-to-view triggered.");
}

function runListMessages(pending: Annotations) {
	const list = pending.all();
	if (list.length === 0) return text("No pending messages");
	return text(JSON.stringify(list, null, 2));
}

function runAckMessages(args: Args, pending: Annotations) {
	if (!args.ids?.length)
		return text("ids is required for action=ack_messages", true);
	const { matched, unknown } = pending.ack(args.ids);
	if (matched.length === 0) {
		return text(
			`No matches: ${args.ids.length} id(s) did not correspond to any pending message. Use maket_workspace list_messages to see current ids.`,
			true,
		);
	}
	const suffix =
		unknown.length > 0
			? ` (${unknown.length} unknown id(s) ignored: ${unknown.join(", ")})`
			: "";
	return text(
		`Acknowledged ${matched.length} of ${args.ids.length} message(s)${suffix}.`,
	);
}

export const workspacePack: ToolPack = {
	id: "workspace",
	name: "Workspace",
	requires: ["documents", "bus", "pending", "collectionCursors"],
	declaresTools: ["maket_workspace"],
	register(container) {
		container.register({
			maketWorkspaceTool: asFunction(createMaketWorkspaceTool).singleton(),
		});
	},
};
