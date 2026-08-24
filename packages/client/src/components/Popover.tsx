import { LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { randomId } from "../utils";

export function Popover() {
	const model = usePopoverModel();
	if (!model) return null;
	return <PopoverView {...model} />;
}

// code-moniker: ignore[smell-feature-envy-local]
// This hook is a DOM positioning adapter for the popover shell; it coordinates browser events and local UI state rather than domain behavior.
function usePopoverModel() {
	const t = useT();
	const selectedId = useStore((s) =>
		s.selectedIds.length === 1 ? s.selectedIds[0] : null,
	);
	const showPopover = useStore((s) => s.showPopover);
	const isEditing = useStore((s) => s.editingElementId !== null);
	const focusedDocName = useStore((s) => s.focusedDocName);
	const focusedDoc = useStore((s) =>
		s.focusedDocName ? s.docs.get(s.focusedDocName) : null,
	);
	const addPending = useStore((s) => s.addPending);
	const pending = useStore((s) => s.pending);
	const [note, setNote] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const popRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ top: number; left: number }>({
		top: 140,
		left: 0,
	});

	useEffect(() => {
		setNote("");
		setError(null);
		setSaving(false);
	}, [selectedId]);

	useLayoutEffect(() => {
		if (!selectedId) return;
		const el = selectedElement(selectedId);
		if (!el) return;
		setPos(
			positionPopover(selectedId, el, popRef.current?.offsetHeight || 200),
		);
	}, [selectedId]);

	if (!selectedId || !showPopover || isEditing) return null;

	const el = selectedElement(selectedId);
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
		popRef,
		textareaRef,
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

function selectedElement(selectedId: string): HTMLElement | null {
	return document.querySelector(
		`[data-id="${selectedId}"]`,
	) as HTMLElement | null;
}

function selectedElementPageIndex(el: HTMLElement): number {
	const pageCanvas = el.closest(".page-canvas") as HTMLElement | null;
	return pageCanvas ? Number.parseInt(pageCanvas.dataset.page ?? "0", 10) : 0;
}

function positionPopover(
	selectedId: string,
	el: HTMLElement,
	popoverHeight: number,
): { top: number; left: number } {
	const rect = el.getBoundingClientRect();
	const popW = 240;
	const gap = 12;
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const rightSide = rect.right + gap + popW < vw;
	const leftSide = rect.left - gap - popW > 0;
	const left = rightSide
		? rect.right + gap
		: leftSide
			? rect.left - gap - popW
			: vw - popW - 20;
	const top = Math.max(20, Math.min(rect.top, vh - popoverHeight - 20));
	console.log("[popover] position:", {
		id: selectedId,
		elRect: { top: rect.top, right: rect.right, left: rect.left },
		popover: { top, left },
	});
	return { top, left };
}

function PopoverView(model: NonNullable<ReturnType<typeof usePopoverModel>>) {
	const {
		t,
		popRef,
		textareaRef,
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
			ref={popRef}
			className="fixed w-[240px] bg-panel rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.15)] z-[150] overflow-hidden"
			style={{
				top: pos.top,
				left: pos.left,
				animation: "popoverIn 250ms cubic-bezier(0.16, 1, 0.3, 1)",
			}}
		>
			{focusedDocName && (
				<div className="px-3 pt-2 text-2xs text-text-3 truncate">
					{focusedDocName}
					{focusedDoc && focusedDoc.pages.length > 1
						? ` · ${pageName || `p.${pageIndex + 1}`}`
						: ""}
				</div>
			)}
			<div className="px-3 pt-1 pb-2 flex items-center gap-2">
				<span className="text-base font-bold flex-1 truncate">{elName}</span>
				<button
					type="button"
					onClick={toggleDelete}
					disabled={saving}
					className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
						isFlaggedDelete
							? "bg-danger/10 text-danger"
							: "text-text-3 hover:text-danger hover:bg-danger-soft"
					}`}
					title={isFlaggedDelete ? t("flagged_delete") : t("delete")}
				>
					<Trash2 size={14} />
				</button>
			</div>

			<div className="px-3 pb-3 flex flex-col gap-2">
				{existingNote && (
					<div className="flex items-center gap-2 px-2 py-1.5 bg-amber-50 rounded-lg text-xs text-amber-700">
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

				<div className="flex gap-1.5">
					<textarea
						ref={textareaRef}
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
						rows={2}
						className="flex-1 px-2.5 py-1.5 bg-input rounded-lg text-sm outline-none placeholder:text-text-3 focus:ring-2 focus:ring-accent/20 resize-none"
					/>
					{note && (
						<button
							type="button"
							onClick={submitNote}
							disabled={saving}
							aria-busy={saving}
							aria-label={t("pending_send_note")}
							className="px-2.5 self-end py-1.5 bg-accent text-accent-contrast text-xs font-semibold rounded-lg hover:brightness-110 transition"
						>
							{saving ? (
								<LoaderCircle
									size={12}
									className="animate-spin"
									aria-hidden="true"
								/>
							) : (
								<svg
									aria-hidden="true"
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
								</svg>
							)}
						</button>
					)}
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
