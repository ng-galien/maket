/**
 * Document workspace command handlers.
 */

import {
	normalizeCategoryPath,
	type WorkspaceCommand,
	type WorkspaceStateSignal,
} from "@maket/shared";
import type WebSocket from "ws";
import { createDocument } from "../../types.js";
import type { WsHandlerContext } from "./context.js";

export function handleLoadDocument(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "load_document" }>,
	ws: WebSocket,
): void {
	let requested = ctx.documents.resolve(msg.name);
	if (!requested) {
		const loaded = ctx.store.loadOne(msg.name);
		if (loaded) {
			ctx.documents.all().set(loaded.name, loaded);
			requested = loaded;
		}
	}
	if (!requested) return;
	const state: WorkspaceStateSignal = {
		type: "state",
		doc: ctx.documents.lightView(ctx.documentRenderer.render(requested)),
		documentState: ctx.documentRenderer.stateView(requested),
		docList: ctx.documents.list(),
		collections: ctx.collections.loadAll(),
		collectionCursors: ctx.collectionCursors.snapshot(),
		annotations: ctx.pending.all(),
		charteCss: ctx.documents.charteCss(requested),
		addToWorkspace: true,
		focus: true,
	};
	ws.send(JSON.stringify(state));
}

export function handleUpdateMeta(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "update_meta" }>,
): void {
	const d = ctx.wsDoc(msg);
	if (!d) return;
	if (d.meta?.locked === true) {
		ctx.bus.emit("toast", {
			key: "toast_document_locked_meta",
			params: { doc: d.name },
			level: "info",
		});
		return;
	}
	if (!d.meta) d.meta = {};
	if (msg.designNotes !== undefined) d.meta.designNotes = msg.designNotes;
	if (msg.teamNotes !== undefined) d.meta.teamNotes = msg.teamNotes;
	if (msg.rating !== undefined)
		d.meta.rating = Math.max(0, Math.min(5, Number(msg.rating) || 0));
	if (msg.charte !== undefined) d.meta.charte = msg.charte;
	if (msg.category !== undefined)
		d.category = normalizeCategoryPath(msg.category);
	ctx.documents.persist(d.name);
	ctx.bus.emit("meta:updated", { docName: d.name });
}

export function handleMoveCategory(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "move_category" }>,
): void {
	const source = normalizeCategoryPath(msg.source);
	const destination = normalizeCategoryPath(msg.destination);
	if (!source || source === destination) return;
	if (destination.startsWith(`${source}/`)) {
		ctx.bus.emit("toast", {
			key: "toast_category_cycle",
			level: "error",
		});
		return;
	}

	const result = ctx.documents.moveCategory(source, destination);
	if (result.lockedDocName) {
		ctx.bus.emit("toast", {
			key: "toast_category_locked_document",
			params: { doc: result.lockedDocName },
			level: "info",
		});
		return;
	}
	const snapshotDoc = result.moved[0];
	if (!snapshotDoc) return;
	ctx.bus.emit("meta:updated", { docName: snapshotDoc.name });
	ctx.bus.emit("toast", {
		key: "toast_category_moved",
		params: { source, destination },
		level: "success",
	});
}

export function handleDeleteDocument(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "delete_document" }>,
): void {
	const name = msg.name;
	const d = ctx.documents.resolve(name ?? "");
	if (!name || !d || ctx.documents.all().size <= 1) return;
	if (d.meta?.locked === true) {
		ctx.bus.emit("toast", {
			key: "toast_document_locked_delete",
			params: { doc: name },
			level: "info",
		});
		return;
	}
	ctx.documents.delete(name);
	ctx.bus.emit("document:deleted", { docName: name });
}

export function handleRenameDocument(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "rename_document" }>,
): void {
	const { name, newName } = msg;
	if (!name || !newName || name === newName) return;
	const d = ctx.documents.resolve(name);
	if (!d) return;
	if (d.meta?.locked === true) {
		ctx.bus.emit("toast", {
			key: "toast_document_locked_rename",
			params: { doc: name },
			level: "info",
		});
		return;
	}
	if (ctx.documents.all().has(newName)) {
		ctx.bus.emit("toast", {
			key: "toast_document_name_taken",
			params: { name: newName },
			level: "error",
		});
		return;
	}
	ctx.documents.rename(name, newName);
	ctx.bus.emit("document:renamed", { oldName: name, docName: newName });
	ctx.bus.emit("toast", {
		key: "toast_document_renamed",
		params: { from: name, to: newName },
		level: "success",
	});
}

export function handleDuplicateDocument(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "duplicate_document" }>,
): void {
	const { name, newName } = msg;
	if (!name || !newName) return;
	const src = ctx.documents.resolve(name);
	if (!src) return;
	if (ctx.documents.all().has(newName)) {
		ctx.bus.emit("toast", {
			key: "toast_document_name_taken",
			params: { name: newName },
			level: "error",
		});
		return;
	}
	const cloneData = structuredClone({
		name: newName,
		category: src.category,
		canvas: src.canvas,
		meta: src.meta,
		pages: src.pages,
		activePage: src.activePage,
		nextId: src.nextId,
	});
	if (cloneData.meta) cloneData.meta.locked = false;
	const clone = createDocument(cloneData);
	ctx.documents.all().set(clone.name, clone);
	ctx.documents.persist(clone.name);
	ctx.bus.emit("document:created", { docName: clone.name });
	ctx.bus.emit("toast", {
		key: "toast_document_cloned",
		params: { doc: name, clone: clone.name },
		level: "success",
	});
}

export function handleLockDocument(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "lock_document" }>,
): void {
	const { name, locked } = msg;
	if (!name) return;
	const d = ctx.documents.resolve(name);
	if (!d) return;
	if (!d.meta) d.meta = {};
	d.meta.locked = locked === true;
	ctx.documents.persist(d.name);
	ctx.bus.emit("meta:updated", { docName: d.name });
	ctx.bus.emit("toast", {
		key: locked ? "toast_document_locked" : "toast_document_unlocked",
		params: { doc: d.name },
		level: "info",
	});
}
