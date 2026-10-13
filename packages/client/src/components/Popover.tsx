import { Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { elementBox } from "../lib/annotationMarkers";
import type { MessageAnchor } from "../store/useStore";
import { useStore } from "../store/useStore";
import { randomId } from "../utils";

const SENT_VISIBLE_MS = 900;
const FIELD_MAX_HEIGHT = 168;

interface AnchorRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

/** The message field a person opens on an element or a page for the agent. */
export function Popover() {
	const model = usePopoverModel();
	if (!model) return null;
	return <PopoverView {...model} />;
}

function anchorPage(anchor: MessageAnchor): HTMLElement | null {
	const pages = document.querySelectorAll<HTMLElement>(
		`[data-doc="${CSS.escape(anchor.docName)}"] .page-canvas[data-page="${anchor.pageIndex}"]`,
	);
	return pages[0] ?? null;
}

function anchorElement(anchor: MessageAnchor): HTMLElement | null {
	if (!anchor.elementId) return anchorPage(anchor);
	return selectedElement(anchor.elementId, anchor.docName, anchor.pageIndex);
}

function anchorRect(anchor: MessageAnchor): AnchorRect | null {
	const element = anchorElement(anchor);
	if (!element) return null;
	const rect = anchor.elementId
		? elementBox(element)
		: element.getBoundingClientRect();
	if (anchor.elementId || !anchor.point) return rect;
	const scaleX = element.offsetWidth ? rect.width / element.offsetWidth : 1;
	const scaleY = element.offsetHeight ? rect.height / element.offsetHeight : 1;
	const left = rect.left + anchor.point.x * scaleX;
	const top = rect.top + anchor.point.y * scaleY;
	return { left, top, right: left, bottom: top, width: 0, height: 0 };
}

function usePopoverPosition(
	anchor: MessageAnchor | null,
	popover: HTMLDivElement | null,
) {
	const [position, setPosition] = useState({ top: 140, left: 0 });
	useLayoutEffect(() => {
		if (!anchor) return;
		const element = anchorElement(anchor);
		const updatePosition = () => {
			const rect = anchorRect(anchor);
			const surface = anchorPage(anchor);
			if (rect) setPosition(positionPopover(rect, surface, popover));
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
	}, [anchor, popover]);
	return position;
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// This hook adapts the message field to the DOM and the pending queue; queue ownership stays in Zustand.
function usePopoverModel() {
	const t = useT();
	const anchor = useStore((s) => s.messageAnchor);
	const isEditing = useStore((s) => s.editingElementId !== null);
	const anchorDoc = useStore((s) =>
		s.messageAnchor ? s.docs.get(s.messageAnchor.docName) : null,
	);
	const readOnly = useStore((state) => state.readOnly);
	const inaccessible = readOnly || anchorDoc?.meta?.locked === true;
	const addPending = useStore((s) => s.addPending);
	const pending = useStore((s) => s.pending);
	const [note, setNote] = useState("");
	const [saving, setSaving] = useState(false);
	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [popover, setPopover] = useState<HTMLDivElement | null>(null);
	const pos = usePopoverPosition(anchor, popover);

	useEffect(() => {
		setNote("");
		setError(null);
		setSaving(false);
		setSent(false);
	}, [anchor]);

	useEffect(() => {
		if (!sent) return;
		const timeout = window.setTimeout(
			() => closeField(anchor, false),
			SENT_VISIBLE_MS,
		);
		return () => window.clearTimeout(timeout);
	}, [anchor, sent]);

	useEffect(() => {
		if (inaccessible && anchor) useStore.getState().closeMessageField();
	}, [anchor, inaccessible]);

	if (!anchor || isEditing || inaccessible) return null;

	const el = anchorElement(anchor);
	if (!el) return null;

	const { docName, pageIndex, elementId } = anchor;
	const page = anchorDoc?.pages?.[pageIndex];
	const pageLabel = page?.name || `${t("page")} ${pageIndex + 1}`;
	const sameAnchor = (m: (typeof pending)[number]) =>
		m.docName === docName &&
		m.pageIndex === pageIndex &&
		(m.elementId ?? null) === (elementId ?? null);
	const flaggedDelete = elementId
		? pending.find((m) => m.type === "delete" && sameAnchor(m))
		: undefined;
	const pendingHere = pending.filter((m) => m.type === "note" && sameAnchor(m));
	const anchorLabel = elementId
		? el.dataset.name || el.textContent?.trim().slice(0, 32) || elementId
		: t("message_anchor_page");

	const submitNote = async () => {
		const text = note.trim();
		if (!text || saving || sent) return;
		setSaving(true);
		setError(null);
		const outcome = await addPending({
			id: randomId(),
			type: "note",
			docName,
			pageIndex,
			...(elementId ? { elementId } : {}),
			text,
			ts: Date.now(),
		});
		setSaving(false);
		if (!outcome.ok) {
			setError(outcome.error ?? t("pending_create_failed"));
			return;
		}
		setSent(true);
	};

	const toggleDelete = async () => {
		if (!elementId || saving) return;
		if (flaggedDelete) {
			useStore.getState().removePending(flaggedDelete.id);
			return;
		}
		setSaving(true);
		setError(null);
		const outcome = await addPending({
			id: randomId(),
			type: "delete",
			elementId,
			docName,
			pageIndex,
			ts: Date.now(),
		});
		setSaving(false);
		if (!outcome.ok) {
			setError(outcome.error ?? t("pending_create_failed"));
			return;
		}
		closeField(anchor, true);
	};

	return {
		t,
		setPopover,
		pos,
		docName,
		pageLabel,
		anchorLabel,
		isPageAnchor: !elementId,
		pendingHere,
		flaggedDelete: Boolean(flaggedDelete),
		note,
		setNote: (value: string) => {
			setNote(value);
			if (error) setError(null);
		},
		saving,
		sent,
		error,
		submitNote,
		toggleDelete,
		cancel: () => closeField(anchor, true),
	};
}

/** Closes the field and gives the keyboard back to the anchor it came from. */
function closeField(anchor: MessageAnchor | null, restoreFocus: boolean) {
	const target = anchor ? anchorElement(anchor) : null;
	useStore.getState().closeMessageField();
	if (restoreFocus && target?.hasAttribute("tabindex")) target.focus();
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

function positionPopover(
	rect: AnchorRect,
	surface: HTMLElement | null,
	popover: HTMLDivElement | null,
): { top: number; left: number } {
	const popW = popover?.offsetWidth || 280;
	const popH = popover?.offsetHeight || 220;
	const gap = 12;
	const margin = 16;
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const surfaceRect = surface?.getBoundingClientRect();
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

function PinGlyph({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			width="14"
			height="14"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
			<circle cx="12" cy="10" r="2.2" />
		</svg>
	);
}

function SendGlyph() {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			width="13"
			height="13"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M4 12h14M13 6l6 6-6 6" />
		</svg>
	);
}

function CheckGlyph() {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			width="13"
			height="13"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M5 12.5 10 17l9-10" />
		</svg>
	);
}

function KeyHint({ keys, label }: { keys: string; label: string }) {
	return (
		<span className="inline-flex items-center gap-1">
			<kbd className="rounded-[4px] border border-border bg-input px-1 font-sans text-[10px] font-semibold leading-4 text-text-2">
				{keys}
			</kbd>
			<span>{label}</span>
		</span>
	);
}

function PopoverView(model: NonNullable<ReturnType<typeof usePopoverModel>>) {
	const {
		t,
		setPopover,
		pos,
		docName,
		pageLabel,
		anchorLabel,
		isPageAnchor,
		pendingHere,
		flaggedDelete,
		note,
		setNote,
		saving,
		sent,
		error,
		submitNote,
		toggleDelete,
		cancel,
	} = model;
	const fieldRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		fieldRef.current?.focus();
	}, []);
	useLayoutEffect(() => {
		const field = fieldRef.current;
		if (!field) return;
		field.style.height = "auto";
		if (note)
			field.style.height = `${Math.min(field.scrollHeight, FIELD_MAX_HEIGHT)}px`;
	}, [note]);
	return (
		<div
			ref={setPopover}
			role="dialog"
			aria-label={t("message_dialog")}
			data-annotation-popover=""
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				event.stopPropagation();
				cancel();
			}}
			className="fixed z-[var(--z-popover)] w-[280px] overflow-hidden rounded-lg border border-border bg-panel shadow-[0_12px_36px_rgba(15,23,42,0.22)]"
			style={{
				top: pos.top,
				left: pos.left,
				animation: "popoverIn 160ms cubic-bezier(0.16, 1, 0.3, 1)",
			}}
		>
			<div className="flex items-start gap-2 border-b border-border px-3 py-2">
				<div className="min-w-0 flex-1">
					<div className="truncate text-2xs font-medium text-text-3">
						{docName} · {pageLabel}
					</div>
					<div className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-text-1">
						<PinGlyph className="shrink-0 text-accent" />
						<span className="truncate" data-message-anchor-label="">
							{anchorLabel}
						</span>
					</div>
				</div>
				{!isPageAnchor && (
					<button
						type="button"
						onClick={toggleDelete}
						disabled={saving || sent}
						aria-pressed={flaggedDelete}
						aria-label={flaggedDelete ? t("flagged_delete") : t("delete")}
						title={flaggedDelete ? t("flagged_delete") : t("delete")}
						className={`flex size-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger ${
							flaggedDelete
								? "bg-danger-soft text-danger"
								: "text-text-3 hover:bg-danger-soft hover:text-danger"
						}`}
					>
						<Trash2 size={13} aria-hidden="true" />
					</button>
				)}
			</div>

			<div className="flex flex-col gap-2 p-3">
				{pendingHere.length > 0 && !sent && (
					<div className="rounded-md border border-border bg-input px-2 py-1.5 text-xs leading-snug text-text-2">
						<div className="font-medium text-text-3">
							{t("message_pending_here", { count: pendingHere.length })}
						</div>
						<p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words">
							{pendingHere[pendingHere.length - 1]?.text}
						</p>
					</div>
				)}

				<textarea
					ref={fieldRef}
					value={note}
					aria-label={t("message_dialog")}
					aria-invalid={error ? true : undefined}
					readOnly={sent}
					onChange={(e) => setNote(e.target.value)}
					onKeyDown={(e) => {
						if (
							e.key === "Enter" &&
							!e.shiftKey &&
							!e.nativeEvent.isComposing
						) {
							e.preventDefault();
							submitNote();
						}
					}}
					placeholder={t("message_placeholder")}
					rows={3}
					className="min-h-[68px] w-full resize-none rounded-md border border-border bg-input px-2.5 py-2 text-sm leading-snug text-text-1 outline-none placeholder:text-text-3 transition-[border-color,box-shadow] focus:border-accent/60 focus:ring-2 focus:ring-accent/15 read-only:opacity-70"
				/>
				<div className="flex items-center gap-2">
					{sent ? (
						<p
							className="flex flex-1 items-center gap-1.5 text-xs font-semibold text-accent"
							role="status"
						>
							<CheckGlyph />
							{t("message_sent")}
						</p>
					) : (
						<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-text-3">
							<KeyHint keys={t("key_enter")} label={t("hint_send")} />
							<KeyHint keys={t("key_shift_enter")} label={t("hint_newline")} />
							<KeyHint keys={t("key_escape")} label={t("hint_cancel")} />
						</div>
					)}
					{!sent && (
						<button
							type="button"
							onClick={submitNote}
							disabled={saving || !note.trim()}
							aria-busy={saving}
							aria-label={t("pending_send_note")}
							title={t("pending_send_note")}
							className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 text-xs font-semibold text-accent-contrast transition-[filter,opacity] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default disabled:opacity-35"
						>
							<SendGlyph />
							<span>{saving ? t("pending_sending") : t("message_send")}</span>
						</button>
					)}
				</div>
				{error && (
					<p className="text-xs font-medium text-danger" role="alert">
						{error}
					</p>
				)}
			</div>
		</div>
	);
}
