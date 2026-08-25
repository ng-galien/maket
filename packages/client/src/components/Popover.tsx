import { LoaderCircle, MessageCircle, Send, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { randomId } from "../utils";

export function Popover() {
	const model = usePopoverModel();
	if (!model) return null;
	return <PopoverView {...model} />;
}

function usePopoverPosition({
	selectedId,
	showPopover,
	docName,
	pageIndex,
	popover,
}: {
	selectedId: string | null;
	showPopover: boolean;
	docName: string | null;
	pageIndex: number;
	popover: HTMLDivElement | null;
}) {
	const [position, setPosition] = useState({ top: 140, left: 0 });
	useLayoutEffect(() => {
		if (!selectedId || !showPopover) return;
		const element = selectedElement(selectedId, docName, pageIndex);
		const updatePosition = () => {
			const currentElement = selectedElement(selectedId, docName, pageIndex);
			if (currentElement) {
				setPosition(positionPopover(currentElement, popover));
			}
		};
		updatePosition();
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);
		const observer =
			typeof ResizeObserver !== "undefined"
				? new ResizeObserver(updatePosition)
				: null;
		for (const observed of [
			popover,
			element,
			element?.closest(".page-canvas"),
			document.querySelector("[data-library-panel]"),
		]) {
			if (observed) observer?.observe(observed);
		}
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
		};
	}, [docName, pageIndex, popover, selectedId, showPopover]);
	return position;
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// This hook is a DOM positioning adapter for the popover shell; it coordinates browser events and local UI state rather than domain behavior.
function usePopoverModel() {
	const t = useT();
	const selectedId = useStore((s) =>
		s.selectedIds.length === 1 ? s.selectedIds[0] : null,
	);
	const showPopover = useStore((s) => s.showPopover);
	const isEditing = useStore((s) => s.editingElementId !== null);
	const focusedDocName = useStore((s) => s.focusedDocName);
	const focusedPageIndex = useStore((s) => s.focusedPageIndex);
	const focusedDoc = useStore((s) =>
		s.focusedDocName ? s.docs.get(s.focusedDocName) : null,
	);
	const addPending = useStore((s) => s.addPending);
	const pending = useStore((s) => s.pending);
	const [note, setNote] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [popover, setPopover] = useState<HTMLDivElement | null>(null);
	const pos = usePopoverPosition({
		selectedId,
		showPopover,
		docName: focusedDocName,
		pageIndex: focusedPageIndex,
		popover,
	});

	useEffect(() => {
		setNote("");
		setError(null);
		setSaving(false);
	}, [selectedId]);

	if (!selectedId || !showPopover || isEditing) return null;

	const el = selectedElement(selectedId, focusedDocName, focusedPageIndex);
	if (!el) return null;

	const pageIndex = selectedElementPageIndex(el);
	const pageName = focusedDoc?.pages?.[pageIndex]?.name;
	const isFlaggedDelete = pending.some(
		(m) =>
			m.type === "delete" &&
			m.docName === focusedDocName &&
			m.pageIndex === pageIndex &&
			m.elementId === selectedId,
	);
	const existingNote = pending.find(
		(m) =>
			m.type === "note" &&
			m.docName === focusedDocName &&
			m.pageIndex === pageIndex &&
			m.elementId === selectedId,
	);
	const elName = el.dataset.name || el.textContent?.slice(0, 20) || selectedId;

	const deselect = () => useStore.getState().selectElement(null);
	const submitNote = async () => {
		const text = note.trim();
		if (!text || saving) return;
		setSaving(true);
		setError(null);
		const outcome = await addPending({
			id: randomId(),
			type: "note",
			elementId: selectedId,
			docName: focusedDocName ?? undefined,
			pageIndex: pageIndex,
			text,
			ts: Date.now(),
		});
		setSaving(false);
		if (!outcome.ok) {
			setError(t("pending_create_failed"));
			return;
		}
		setNote("");
		deselect();
	};

	const toggleDelete = async () => {
		if (isFlaggedDelete) {
			const msg = pending.find(
				(m) =>
					m.type === "delete" &&
					m.docName === focusedDocName &&
					m.pageIndex === pageIndex &&
					m.elementId === selectedId,
			);
			if (msg) useStore.getState().removePending(msg.id);
		} else {
			if (saving) return;
			setSaving(true);
			setError(null);
			const outcome = await addPending({
				id: randomId(),
				type: "delete",
				elementId: selectedId,
				docName: focusedDocName ?? undefined,
				pageIndex: pageIndex,
				ts: Date.now(),
			});
			setSaving(false);
			if (!outcome.ok) {
				setError(t("pending_create_failed"));
				return;
			}
			deselect();
		}
	};

	return {
		t,
		setPopover,
		pos,
		focusedDocName,
		focusedDoc,
		pageName,
		pageIndex,
		elName,
		existingNote,
		isFlaggedDelete,
		note,
		setNote: (value: string) => {
			setNote(value);
			if (error) setError(null);
		},
		saving,
		error,
		submitNote,
		toggleDelete,
	};
}

function selectedElement(
	selectedId: string,
	docName: string | null,
	pageIndex: number,
): HTMLElement | null {
	const elementSelector = `[data-id="${CSS.escape(selectedId)}"]`;
	if (docName) {
		const pages = document.querySelectorAll(
			`[data-doc="${CSS.escape(docName)}"] .page-canvas[data-page="${pageIndex}"]`,
		);
		for (const page of pages) {
			const selected = page.querySelector<HTMLElement>(
				`${elementSelector}.selected`,
			);
			if (selected) return selected;
		}
		for (const page of pages) {
			const element = page.querySelector<HTMLElement>(elementSelector);
			if (element) return element;
		}
		return null;
	}
	return (
		document.querySelector<HTMLElement>(`${elementSelector}.selected`) ??
		document.querySelector<HTMLElement>(elementSelector)
	);
}

function selectedElementPageIndex(el: HTMLElement): number {
	const pageCanvas = el.closest(".page-canvas") as HTMLElement | null;
	return pageCanvas ? Number.parseInt(pageCanvas.dataset.page ?? "0", 10) : 0;
}

function positionPopover(
	el: HTMLElement,
	popover: HTMLDivElement | null,
): { top: number; left: number } {
	const rect = el.getBoundingClientRect();
	const popW = popover?.offsetWidth || 280;
	const popH = popover?.offsetHeight || 220;
	const gap = 12;
	const margin = 16;
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const surfaceRect = el.closest(".page-canvas")?.getBoundingClientRect();
	const libraryRect = document
		.querySelector<HTMLElement>(
			'[data-library-panel][data-library-mode="extended"]',
		)
		?.getBoundingClientRect();
	const maxLeft = vw - popW - margin;
	const workspaceLeft = Math.min(
		Math.max(margin, surfaceRect?.left ?? margin, libraryRect?.right ?? margin),
		maxLeft,
	);
	const rightSide = rect.right + gap + popW <= vw - margin;
	const leftSide = rect.left - gap - popW >= workspaceLeft;
	const left = rightSide
		? rect.right + gap
		: leftSide
			? rect.left - gap - popW
			: Math.max(workspaceLeft, Math.min(rect.right - popW, maxLeft));
	const top = Math.max(
		margin,
		Math.min(rect.top + rect.height / 2 - popH / 2, vh - popH - margin),
	);
	return { top, left };
}

function PopoverView(model: NonNullable<ReturnType<typeof usePopoverModel>>) {
	const {
		t,
		setPopover,
		pos,
		focusedDocName,
		focusedDoc,
		pageName,
		pageIndex,
		elName,
		existingNote,
		isFlaggedDelete,
		note,
		setNote,
		saving,
		error,
		submitNote,
		toggleDelete,
	} = model;
	return (
		<div
			ref={setPopover}
			role="dialog"
			aria-label={t("comment")}
			data-annotation-popover=""
			className="fixed z-[var(--z-popover)] w-[280px] overflow-hidden rounded-xl border border-border bg-panel shadow-[0_18px_52px_rgba(0,0,0,0.24)]"
			style={{
				top: pos.top,
				left: pos.left,
				animation: "popoverIn 160ms cubic-bezier(0.16, 1, 0.3, 1)",
			}}
		>
			<div className="flex items-start gap-3 border-b border-border px-3.5 py-3">
				<div className="min-w-0 flex-1">
					{focusedDocName && (
						<div className="mb-1 truncate text-2xs font-medium text-text-3">
							{focusedDocName}
							{focusedDoc && focusedDoc.pages.length > 1
								? ` · ${pageName || `p.${pageIndex + 1}`}`
								: ""}
						</div>
					)}
					<div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text-1">
						<MessageCircle size={14} className="shrink-0 text-accent" />
						<span className="truncate">{elName}</span>
					</div>
				</div>
				<button
					type="button"
					onClick={toggleDelete}
					disabled={saving}
					className={`flex size-8 shrink-0 items-center justify-center rounded-md transition-colors ${
						isFlaggedDelete
							? "bg-danger/10 text-danger"
							: "text-text-3 hover:text-danger hover:bg-danger-soft"
					}`}
					title={isFlaggedDelete ? t("flagged_delete") : t("delete")}
				>
					<Trash2 size={14} />
				</button>
			</div>

			<div className="flex flex-col gap-2.5 p-3.5">
				{existingNote && (
					<div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-xs leading-relaxed text-amber-700">
						<svg
							aria-hidden="true"
							width="10"
							height="10"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.5"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="shrink-0"
						>
							<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
						</svg>
						{existingNote.text}
					</div>
				)}

				<textarea
					value={note}
					aria-invalid={error ? true : undefined}
					onChange={(e) => setNote(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							submitNote();
						}
					}}
					placeholder={t("note_placeholder")}
					rows={3}
					className="min-h-[82px] w-full resize-none rounded-lg border border-border bg-input px-3 py-2.5 text-sm leading-relaxed text-text-1 outline-none placeholder:text-text-3 transition-[border-color,box-shadow] focus:border-accent/60 focus:ring-2 focus:ring-accent/15"
				/>
				<div className="flex items-center justify-end">
					<button
						type="button"
						onClick={submitNote}
						disabled={saving || !note.trim()}
						aria-busy={saving}
						aria-label={t("pending_send_note")}
						className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-accent-contrast transition-[filter,opacity] hover:brightness-110 disabled:cursor-default disabled:opacity-35"
					>
						{saving ? (
							<LoaderCircle
								size={12}
								className="animate-spin"
								aria-hidden="true"
							/>
						) : (
							<Send size={12} aria-hidden="true" />
						)}
						<span>{t("pending_send_note")}</span>
					</button>
				</div>
				{saving && (
					<p className="text-xs font-medium text-text-2" aria-live="polite">
						{t("pending_sending")}
					</p>
				)}
				{error && (
					<p className="text-xs font-medium text-danger" role="alert">
						{error}
					</p>
				)}
			</div>
		</div>
	);
}
