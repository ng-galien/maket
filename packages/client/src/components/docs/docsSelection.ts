import type { DocSummary } from "../../store/types";
import { sendDeleteDoc, sendLockDoc, wsSend } from "../../store/ws";
import { exportMaketBundle } from "./docsImportExport";
import type { BulkActionBarActions, SelectionContext } from "./types";

export function handleDocSelection(
	name: string,
	event: React.MouseEvent,
	context: SelectionContext,
) {
	if (event.metaKey || event.ctrlKey) {
		event.preventDefault();
		toggleSelectedName(name, context);
		return;
	}
	if (event.shiftKey && context.lastClicked) {
		event.preventDefault();
		selectRange(name, context);
		return;
	}
	if (context.selected.size > 0) context.clearSelection();
	context.setLastClicked(name);
	context.openDoc(name);
}

function toggleSelectedName(name: string, context: SelectionContext) {
	context.setSelected((prev) => {
		const next = new Set(prev);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		return next;
	});
	context.setLastClicked(name);
}

function selectRange(name: string, context: SelectionContext) {
	const from = context.flatOrder.indexOf(context.lastClicked ?? "");
	const to = context.flatOrder.indexOf(name);
	if (from < 0 || to < 0) return;
	const [lo, hi] = from < to ? [from, to] : [to, from];
	context.setSelected((prev) => {
		const next = new Set(prev);
		for (let index = lo; index <= hi; index++) {
			const selectedName = context.flatOrder[index];
			if (selectedName) next.add(selectedName);
		}
		return next;
	});
}

export function createBulkActions(
	docList: DocSummary[],
	selected: Set<string>,
	clearSelection: () => void,
): BulkActionBarActions {
	return {
		clear: clearSelection,
		lock: () => applyBulkLock(docList, selected, true, clearSelection),
		unlock: () => applyBulkLock(docList, selected, false, clearSelection),
		recategorize: (cat) =>
			applyBulkCategory(docList, selected, cat, clearSelection),
		delete: () => applyBulkDelete(docList, selected, clearSelection),
		export: () => {
			exportMaketBundle([...selected]);
			clearSelection();
		},
	};
}

function applyBulkLock(
	docList: DocSummary[],
	selected: Set<string>,
	locked: boolean,
	clearSelection: () => void,
) {
	for (const name of selected) {
		const doc = docList.find((item) => item.name === name);
		if (doc && (doc.locked === true) !== locked) sendLockDoc(name, locked);
	}
	clearSelection();
}

function applyBulkCategory(
	docList: DocSummary[],
	selected: Set<string>,
	cat: string,
	clearSelection: () => void,
) {
	const trimmed = cat.trim();
	if (!trimmed) return;
	for (const name of selected) {
		const doc = docList.find((item) => item.name === name);
		if (!doc || doc.category === trimmed || doc.locked === true) continue;
		wsSend({ type: "update_meta", docName: name, category: trimmed });
	}
	clearSelection();
}

function applyBulkDelete(
	docList: DocSummary[],
	selected: Set<string>,
	clearSelection: () => void,
) {
	if (docList.length - selected.size < 1) return;
	for (const name of selected) {
		const doc = docList.find((item) => item.name === name);
		if (doc && doc.locked !== true) sendDeleteDoc(name);
	}
	clearSelection();
}
