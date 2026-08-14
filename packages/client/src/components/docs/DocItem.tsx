import { computeCanvasDims, DEFAULT_ORIENTATION } from "@maket/shared";
import { Eye, History, Lock, Palette } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n/useT";
import type { DocSummary } from "../../store/types";
import { useStore } from "../../store/useStore";
import { DraftPill } from "../shared/DraftPill";
import {
	DocDeleteHold,
	DocInlineCategoryEditor,
	DocInlineNameEditor,
	DocItemMenu,
	DocMenuButton,
	DocRowMenuButton,
} from "./DocMenu";
import { relativeTime } from "./docsQuery";
import type {
	DocItemActions,
	DocItemMeta,
	DocItemModel,
	DocItemProps,
	DocItemRenderProps,
	RowMode,
} from "./types";
import { DRAG_MIME } from "./types";

function docAspectRatio(doc: DocSummary): number {
	const { w, h } = computeCanvasDims(
		doc.format,
		doc.orientation ?? DEFAULT_ORIENTATION,
	);
	return h / w;
}

export interface DocItemFactoryArgs {
	doc: DocSummary;
	docList: DocSummary[];
	selected: Set<string>;
	menuFor: string | null;
	modeFor: { name: string; mode: RowMode } | null;
	draggingName: string | null;
	isOnWorkspace: (name: string) => boolean;
	isFocused: (name: string) => boolean;
	focusDoc: (name: string) => void;
	setMenuFor: React.Dispatch<React.SetStateAction<string | null>>;
	setModeFor: React.Dispatch<
		React.SetStateAction<{ name: string; mode: RowMode } | null>
	>;
	setDraggingName: React.Dispatch<React.SetStateAction<string | null>>;
	setDragOverCat: React.Dispatch<React.SetStateAction<string | null>>;
	rowClick: (name: string, event: React.MouseEvent) => void;
}

export function createDocItemProps(args: DocItemFactoryArgs): DocItemProps {
	const { doc } = args;
	return {
		model: {
			doc,
			onWs: args.isOnWorkspace(doc.name),
			focused: args.isFocused(doc.name),
			selected: args.selected.has(doc.name),
			menuOpen: args.menuFor === doc.name,
			mode:
				args.modeFor?.name === doc.name
					? args.modeFor.mode
					: ({ kind: "idle" } as RowMode),
			canDelete: args.docList.length > 1,
			dragging: args.draggingName === doc.name,
		},
		actions: {
			click: (event) => args.rowClick(doc.name, event),
			focus: () => args.focusDoc(doc.name),
			openMenu: () => args.setMenuFor(doc.name),
			closeMenu: () => args.setMenuFor(null),
			changeMode: (mode) =>
				args.setModeFor(mode.kind === "idle" ? null : { name: doc.name, mode }),
			dragStart: (event) => {
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData(DRAG_MIME, doc.name);
				args.setDraggingName(doc.name);
			},
			dragEnd: () => {
				args.setDraggingName(null);
				args.setDragOverCat(null);
			},
		},
	};
}

export function DocCard({ model, actions }: DocItemProps) {
	const meta = useDocItemMeta(model);
	const menuButtonRef = useRef<HTMLButtonElement>(null);

	return (
		<div
			className={`relative group/card ${model.dragging ? "opacity-40" : ""}`}
			draggable={meta.dragEnabled}
			onDragStart={(event) => handleItemDragStart(event, meta, actions)}
			onDragEnd={actions.dragEnd}
		>
			<DocCardThumb model={model} meta={meta} actions={actions} />
			<DocCardFooter
				model={model}
				meta={meta}
				actions={actions}
				anchorRef={menuButtonRef}
			/>
			<DocItemMenu
				model={model}
				meta={meta}
				actions={actions}
				anchorRef={menuButtonRef}
			/>
		</div>
	);
}

export function DocRow({ model, actions }: DocItemProps) {
	const meta = useDocItemMeta(model);
	const menuButtonRef = useRef<HTMLButtonElement>(null);
	const tooltipDismissed = useRef(false);
	const [tooltipPoint, setTooltipPoint] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const showsInfo = !meta.editing && !meta.confirming;
	const showTooltipAt = (x: number, y: number) => {
		if (showsInfo && !tooltipDismissed.current) setTooltipPoint({ x, y });
	};
	useEffect(() => {
		if (!showsInfo) setTooltipPoint(null);
	}, [showsInfo]);

	return (
		<div
			data-doc-row={model.doc.name}
			className={`relative group flex min-w-0 items-center gap-1 hover:z-20 focus-within:z-20 ${model.dragging ? "opacity-40" : ""}`}
			draggable={meta.dragEnabled}
			onDragStart={(event) => handleItemDragStart(event, meta, actions)}
			onDragEnd={actions.dragEnd}
		>
			<div
				className="relative min-w-0 flex-1"
				onPointerEnter={(event) => {
					tooltipDismissed.current = false;
					showTooltipAt(event.clientX, event.clientY);
				}}
				onPointerMove={(event) => showTooltipAt(event.clientX, event.clientY)}
				onPointerLeave={() => {
					tooltipDismissed.current = false;
					setTooltipPoint(null);
				}}
				onPointerDown={() => {
					tooltipDismissed.current = true;
					setTooltipPoint(null);
				}}
				onFocusCapture={(event) => {
					if (!showsInfo) return;
					if (!(event.target instanceof HTMLElement)) return;
					if (!event.target.matches(":focus-visible")) return;
					const rect = event.target.getBoundingClientRect();
					setTooltipPoint({
						x: rect.left + Math.min(rect.width / 2, 40),
						y: rect.top,
					});
				}}
				onBlurCapture={(event) => {
					if (
						!event.currentTarget.contains(event.relatedTarget as Node | null)
					) {
						setTooltipPoint(null);
					}
				}}
			>
				<DocRowMain model={model} meta={meta} actions={actions} />
				{showsInfo && <DocRowInfo doc={model.doc} point={tooltipPoint} />}
			</div>
			{!meta.editing && !meta.confirming && <DocDraftPill doc={model.doc} />}
			<DocRowMenuButton
				model={model}
				meta={meta}
				actions={actions}
				anchorRef={menuButtonRef}
			/>
			{model.onWs && !meta.editing && !meta.confirming && (
				<DocViewButton model={model} actions={actions} />
			)}
			<DocItemMenu
				model={model}
				meta={meta}
				actions={actions}
				anchorRef={menuButtonRef}
			/>
		</div>
	);
}

function useDocItemMeta(model: DocItemModel): DocItemMeta {
	return {
		locked: model.doc.locked === true,
		editing:
			model.mode.kind === "rename" ||
			model.mode.kind === "duplicate" ||
			model.mode.kind === "move-category",
		confirming: model.mode.kind === "confirm-delete",
		dragEnabled: model.mode.kind === "idle",
	};
}

function handleItemDragStart(
	event: React.DragEvent,
	meta: DocItemMeta,
	actions: DocItemActions,
) {
	if (!meta.dragEnabled) {
		event.preventDefault();
		return;
	}
	actions.dragStart(event);
}

export function DocCardThumb({ model, meta, actions }: DocItemRenderProps) {
	const doc = model.doc;
	const chartesVersion = useStore((state) => state.chartesVersion);
	const cacheToken = `${doc.updatedAt ?? String(Date.now())}-${chartesVersion}`;
	const thumbSrc = `/api/thumb?name=${encodeURIComponent(doc.name)}&page=1&w=480&t=${encodeURIComponent(cacheToken)}`;
	return (
		<button
			type="button"
			onClick={actions.click}
			className={`relative block w-full overflow-hidden rounded-xl border transition bg-white ${cardBorderClass(model)}`}
			style={{ aspectRatio: `1 / ${docAspectRatio(doc)}` }}
		>
			<img
				src={thumbSrc}
				alt={doc.name}
				loading="lazy"
				className="absolute inset-0 w-full h-full object-cover"
				style={{ background: "#fff" }}
				draggable={false}
			/>
			{model.selected && (
				<DocSelectedMark className="absolute top-1.5 right-1.5" />
			)}
			{meta.locked && <DocLockedMark className="absolute top-1.5 left-1.5" />}
			<DocCardBadges doc={doc} />
		</button>
	);
}

function cardBorderClass(model: DocItemModel): string {
	if (model.selected) {
		return "border-accent ring-4 ring-accent/30 shadow-[0_8px_24px_rgba(16,185,129,0.18)]";
	}
	if (model.onWs) {
		return "border-accent/40 ring-2 ring-accent/20 shadow-[0_8px_24px_rgba(16,185,129,0.12)]";
	}
	return "border-black/5 hover:border-black/10 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]";
}

function DocSelectedMark({ className }: { className: string }) {
	return (
		<span
			className={`${className} w-5 h-5 rounded-md bg-accent text-white flex items-center justify-center text-2xs font-bold`}
		>
			✓
		</span>
	);
}

function DocLockedMark({ className }: { className: string }) {
	return (
		<span
			className={`${className} w-5 h-5 rounded-md bg-black/60 text-white flex items-center justify-center`}
		>
			<Lock size={10} />
		</span>
	);
}

export function DocCardBadges({ doc }: { doc: DocSummary }) {
	return (
		<span className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
			{(doc.rating ?? 0) > 0 && (
				<span className="px-1.5 py-0.5 rounded-md bg-amber-100/95 text-amber-600 text-2xs font-bold backdrop-blur">
					★{doc.rating}
				</span>
			)}
		</span>
	);
}

interface DocCardFooterProps extends DocItemRenderProps {
	anchorRef: React.RefObject<HTMLButtonElement | null>;
}

export function DocCardFooter({
	model,
	meta,
	actions,
	anchorRef,
}: DocCardFooterProps) {
	if (meta.editing) {
		return (
			<div className="mt-1">
				{model.mode.kind === "move-category" ? (
					<DocInlineCategoryEditor model={model} actions={actions} />
				) : (
					<DocInlineNameEditor model={model} actions={actions} />
				)}
			</div>
		);
	}
	if (meta.confirming) {
		return (
			<div className="mt-1">
				<DocDeleteHold model={model} actions={actions} />
			</div>
		);
	}
	return (
		<DocCardSummary model={model} actions={actions} anchorRef={anchorRef} />
	);
}

export function DocCardSummary({
	model,
	actions,
	anchorRef,
}: {
	model: DocItemModel;
	actions: DocItemActions;
	anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
	return (
		<div className="mt-1 px-1 flex items-center gap-1.5">
			<div className="flex-1 min-w-0">
				<div
					className={`text-xs truncate ${model.onWs ? "font-bold text-accent" : "font-semibold text-text-1"}`}
				>
					{model.doc.name}
				</div>
				<DocCardMetadata doc={model.doc} />
			</div>
			<DocMenuButton
				model={model}
				actions={actions}
				anchorRef={anchorRef}
				size="card"
			/>
			{model.onWs && <DocViewButton model={model} actions={actions} />}
		</div>
	);
}

export function DocCardMetadata({ doc }: { doc: DocSummary }) {
	const t = useT();
	return (
		<div className="flex items-center gap-1 text-2xs text-text-3">
			<span className="font-bold">{doc.format}</span>
			<span>{doc.pageCount ?? 1}p</span>
			<CharteIndicator doc={doc} />
			{doc.dataModel === "state" && (
				<span
					title={t("state_document_badge_label")}
					className="inline-flex items-center gap-0.5 font-bold text-accent"
				>
					<History size={9} />
					{t("state_document_badge")}
				</span>
			)}
			{(doc.rating ?? 0) > 0 && (
				<span className="text-amber-500">★{doc.rating}</span>
			)}
			<DocDraftPill doc={doc} />
		</div>
	);
}

export function DocRowMain({ model, meta, actions }: DocItemRenderProps) {
	if (model.mode.kind === "move-category")
		return <DocInlineCategoryEditor model={model} actions={actions} />;
	if (meta.editing)
		return <DocInlineNameEditor model={model} actions={actions} />;
	if (meta.confirming) return <DocDeleteHold model={model} actions={actions} />;
	return <DocRowButton model={model} meta={meta} actions={actions} />;
}

export function DocRowButton({ model, meta, actions }: DocItemRenderProps) {
	return (
		<button
			type="button"
			onClick={actions.click}
			aria-describedby={`doc-info-${model.doc.id}`}
			className={`w-full min-h-8 flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${rowBackgroundClass(model)}`}
		>
			<div className="min-w-0 flex-1">
				<DocRowTitle model={model} meta={meta} />
			</div>
		</button>
	);
}

function rowBackgroundClass(model: DocItemModel): string {
	if (model.selected) return "bg-accent/10 ring-2 ring-accent/30";
	return "hover:bg-black/[0.03]";
}

function DocViewButton({
	model,
	actions,
}: {
	model: DocItemModel;
	actions: DocItemActions;
}) {
	const t = useT();
	return (
		<button
			type="button"
			aria-label={t("doc_view", { name: model.doc.name })}
			onClick={(event) => {
				event.stopPropagation();
				actions.focus();
			}}
			className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
				model.focused
					? "bg-accent/10 text-accent"
					: "text-accent/55 hover:bg-accent/10 hover:text-accent"
			} focus-visible:bg-accent/10 focus-visible:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30`}
		>
			<Eye size={16} strokeWidth={2} aria-hidden />
		</button>
	);
}

export function DocRowTitle({
	model,
	meta,
}: {
	model: DocItemModel;
	meta: DocItemMeta;
}) {
	const t = useT();
	return (
		<div
			className={`text-base truncate flex items-center gap-1.5 ${
				model.onWs ? "font-bold text-accent" : "font-medium text-text-2"
			}`}
		>
			{meta.locked && (
				<Lock
					size={11}
					className="text-text-3 flex-shrink-0"
					aria-label={t("doc_locked")}
				/>
			)}
			<span className="truncate">{model.doc.name}</span>
		</div>
	);
}

function CharteIndicator({ doc }: { doc: DocSummary }) {
	const t = useT();
	if (!doc.charteColor) return null;
	return (
		<span
			role="img"
			className="inline-flex flex-shrink-0 items-center gap-0.5 text-text-2"
			title={t("doc_charte", { name: doc.charte || "—" })}
			aria-label={t("doc_charte", { name: doc.charte || "—" })}
		>
			<Palette size={10} aria-hidden />
			<span
				aria-hidden
				className="w-1.5 h-1.5 rounded-[2px] ring-1 ring-black/10"
				style={{ background: doc.charteColor }}
			/>
		</span>
	);
}

function DocRowInfo({
	doc,
	point,
}: {
	doc: DocSummary;
	point: { x: number; y: number } | null;
}) {
	const t = useT();
	const updated = relativeTime(doc.updatedAt, navigator.language);
	const details = [
		doc.format,
		`${doc.pageCount ?? 1}p`,
		doc.dataModel === "state" ? t("state_document_badge_label") : null,
		doc.charte || null,
		(doc.rating ?? 0) > 0 ? `★ ${doc.rating}` : null,
		updated,
	]
		.filter(Boolean)
		.join(" · ");
	return createPortal(
		<div
			id={`doc-info-${doc.id}`}
			role="tooltip"
			className={`doc-row-tooltip ${point ? "doc-row-tooltip--visible" : ""}`}
			style={{
				left: point?.x ?? -9999,
				top: point?.y ?? -9999,
			}}
		>
			{details}
		</div>,
		document.body,
	);
}

function DocDraftPill({ doc }: { doc: DocSummary }) {
	if (!doc.emailDraftUrl) return null;
	return (
		<span className="ml-auto">
			<DraftPill kind={doc.emailDraftRole ?? "body"} url={doc.emailDraftUrl} />
		</span>
	);
}
