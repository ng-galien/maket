import { Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { randomId } from "../utils";

export function Popover() {
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
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const popRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ top: number; left: number }>({
		top: 140,
		left: 0,
	});

	// Reset note when selection changes
	useEffect(() => {
		setNote("");
	}, [selectedId]);

	// Position popover near the selected element
	useLayoutEffect(() => {
		if (!selectedId) return;
		const el = document.querySelector(
			`[data-id="${selectedId}"]`,
		) as HTMLElement | null;
		if (!el) return;

		const rect = el.getBoundingClientRect();
		const popW = 240;
		const gap = 12;
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		// Prefer right side, fall back to left
		let left: number;
		if (rect.right + gap + popW < vw) {
			left = rect.right + gap;
		} else if (rect.left - gap - popW > 0) {
			left = rect.left - gap - popW;
		} else {
			left = vw - popW - 20;
		}

		// Vertical: align with element top, clamp to viewport
		const popH = popRef.current?.offsetHeight || 200;
		let top = rect.top;
		top = Math.max(20, Math.min(top, vh - popH - 20));

		console.log("[popover] position:", {
			id: selectedId,
			elRect: { top: rect.top, right: rect.right, left: rect.left },
			popover: { top, left },
		});
		setPos({ top, left });
	}, [selectedId]);

	if (!selectedId || !showPopover || isEditing) return null;

	const el = document.querySelector(
		`[data-id="${selectedId}"]`,
	) as HTMLElement | null;
	if (!el) return null;

	// Find which page this element is on (from closest .page-canvas[data-page])
	const pageCanvas = el.closest(".page-canvas") as HTMLElement | null;
	const pageIndex = pageCanvas
		? Number.parseInt(pageCanvas.dataset.page ?? "0", 10)
		: 0;
	const pageName = focusedDoc?.pages?.[pageIndex]?.name;

	const isFlaggedDelete = pending.some(
		(m) => m.type === "delete" && m.elementId === selectedId,
	);
	const existingNote = pending.find(
		(m) => m.type === "note" && m.elementId === selectedId,
	);
	const elName = el.dataset.name || el.textContent?.slice(0, 20) || selectedId;

	const deselect = () => useStore.getState().selectElement(null);

	const submitNote = () => {
		if (!note.trim()) return;
		addPending({
			id: randomId(),
			type: "note",
			elementId: selectedId,
			docName: focusedDocName ?? undefined,
			pageIndex: pageIndex,
			text: note.trim(),
			ts: Date.now(),
		});
		setNote("");
		deselect();
	};

	const toggleDelete = () => {
		if (isFlaggedDelete) {
			const msg = pending.find(
				(m) => m.type === "delete" && m.elementId === selectedId,
			);
			if (msg) useStore.getState().removePending(msg.id);
		} else {
			addPending({
				id: randomId(),
				type: "delete",
				elementId: selectedId,
				docName: focusedDocName ?? undefined,
				pageIndex: pageIndex,
				ts: Date.now(),
			});
			deselect();
		}
	};

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
			{/* Header — doc context + element name + delete icon */}
			{focusedDocName && (
				<div className="px-3 pt-2 text-[10px] text-text-3 truncate">
					{focusedDocName}
					{focusedDoc && focusedDoc.pages.length > 1
						? ` · ${pageName || `p.${pageIndex + 1}`}`
						: ""}
				</div>
			)}
			<div className="px-3 pt-1 pb-2 flex items-center gap-2">
				<span className="text-[13px] font-bold flex-1 truncate">{elName}</span>
				<button
					type="button"
					onClick={toggleDelete}
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

			{/* Annotation */}
			<div className="px-3 pb-3 flex flex-col gap-2">
				{/* Existing note indicator */}
				{existingNote && (
					<div className="flex items-center gap-2 px-2 py-1.5 bg-amber-50 rounded-lg text-[11px] text-amber-700">
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

				{/* Note textarea — Shift+Enter to submit */}
				<div className="flex gap-1.5">
					<textarea
						ref={textareaRef}
						value={note}
						onChange={(e) => setNote(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								submitNote();
							}
						}}
						placeholder={t("note_placeholder")}
						rows={2}
						className="flex-1 px-2.5 py-1.5 bg-input rounded-lg text-[12px] outline-none placeholder:text-text-3 focus:ring-2 focus:ring-accent/20 resize-none"
					/>
					{note && (
						<button
							type="button"
							onClick={submitNote}
							className="px-2.5 self-end py-1.5 bg-accent text-white text-[11px] font-semibold rounded-lg hover:brightness-110 transition"
						>
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
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
