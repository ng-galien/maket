import {
	clampPlacedBox,
	FORMATS,
	type PlacedBox,
	placedCompositionFormat,
	SCREEN_FORMATS,
} from "@maket/shared";
import { Image, MessageCircle, Plus, Square, Trash2, Type } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { focusComposerPage, revealComposerPage } from "../desktopCommands";
import { useT } from "../i18n/useT";
import type { Document } from "../store/types";
import {
	sendAddPage,
	sendCanvasFormat,
	sendPlacedElementBox,
	sendRemovePage,
} from "../store/ws";
import { ComposerImagePicker } from "./ComposerImagePicker";
import { HoldToDelete } from "./shared/HoldToDelete";
import { InspectorSection } from "./shared/InspectorSection";
import { InspectorSelect } from "./shared/InspectorSelect";
import { Tooltip } from "./shared/Tooltip";
import { WORKSPACE_TOGGLE_BUTTON_CLASS } from "./shared/toolbarButtonStyles";
import type { PlacementTool } from "./useHandPlacement";

const FIXED_FORMATS = Object.keys(FORMATS).filter(placedCompositionFormat);

type Orientation = "portrait" | "landscape";

const PAGE_BUTTON = `${WORKSPACE_TOGGLE_BUTTON_CLASS} text-text-2 hover:bg-input hover:text-text-1`;

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// UI adapter: the panel turns clicks into WS commands owned by the store module.
/** Tools for the focused page, shown only in the explicit Composer panel. */
export function HandComposePanel({
	doc,
	pageIndex,
	reason,
	children,
	selection,
	selectionActions,
	placement,
}: {
	doc: Document;
	pageIndex: number;
	reason?: string;
	children?: ReactNode;
	selection?: { id: string; box: PlacedBox } | null;
	selectionActions?: {
		id: string;
		kind: "text" | "image" | "frame" | "element";
		canRemove: boolean;
		onComment: () => void;
		onRemove: () => void;
	};
	placement: {
		tool: PlacementTool | null;
		setTool: (tool: PlacementTool | null) => void;
		busy: boolean;
		error: string | null;
	};
}) {
	const t = useT();

	return (
		<div
			data-hand-compose-panel=""
			role="toolbar"
			aria-label={t("hand_compose_bar")}
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
			className="flex flex-col gap-5 p-4"
		>
			{reason && (
				<p role="status" className="text-sm text-text-2">
					{reason}
				</p>
			)}
			<ComposerTools
				doc={doc}
				reason={reason}
				placement={placement}
				selectionActions={selectionActions}
			/>
			{placement.busy && (
				<p role="status" className="text-sm text-text-2">
					{t("hand_placing")}
				</p>
			)}
			{placement.error && (
				<p role="alert" className="text-sm text-danger">
					{placement.error}
				</p>
			)}
			{(children || selection) && (
				<fieldset
					disabled={
						Boolean(reason) || Boolean(placement.tool) || placement.busy
					}
					className="min-w-0 disabled:opacity-40"
				>
					{!placement.tool && !placement.busy && children}
					{!placement.tool && !placement.busy && selection && (
						<PlacedGeometry
							doc={doc}
							pageIndex={pageIndex}
							selection={selection}
						/>
					)}
				</fieldset>
			)}
			<PageOptions
				key={doc.pages[pageIndex]?.id}
				doc={doc}
				pageIndex={pageIndex}
				reason={reason}
			/>
		</div>
	);
}

function ComposerTools({
	doc,
	reason,
	placement,
	selectionActions,
}: Pick<
	Parameters<typeof HandComposePanel>[0],
	"doc" | "reason" | "placement" | "selectionActions"
>) {
	const t = useT();
	const [picking, setPicking] = useState(false);
	const [deletingElement, setDeletingElement] = useState<string | null>(null);
	const imageButtonRef = useRef<HTMLButtonElement>(null);
	useEffect(() => setDeletingElement(null), [selectionActions?.id]);
	const fixed = placedCompositionFormat(doc.canvas.format ?? "A4");

	useEffect(() => {
		if (reason) setPicking(false);
	}, [reason]);
	const chooseTool = (kind: "text" | "frame") => {
		revealComposerPage();
		setPicking(false);
		placement.setTool(placement.tool?.kind === kind ? null : { kind });
	};

	return (
		<>
			<div className="relative">
				<div
					data-composer-tools
					className="flex items-center justify-between gap-2"
				>
					<div
						role="group"
						aria-label={t("hand_insert_tools")}
						className="flex items-center gap-1"
					>
						{fixed &&
							(
								[
									{ kind: "text", Icon: Type, label: "hand_add_text" },
									{ kind: "image", Icon: Image, label: "hand_add_image" },
									{ kind: "frame", Icon: Square, label: "hand_add_frame" },
								] as const
							).map(({ kind, Icon, label }) => (
								<Tooltip key={kind}>
									<button
										ref={kind === "image" ? imageButtonRef : undefined}
										type="button"
										data-image-tool={kind === "image" || undefined}
										aria-label={t(label)}
										title={t(label)}
										data-selected={selectionActions?.kind === kind || undefined}
										aria-pressed={
											kind === "image"
												? picking || placement.tool?.kind === kind
												: placement.tool?.kind === kind
										}
										disabled={Boolean(reason) || placement.busy}
										onClick={() => {
											if (kind === "image") {
												placement.setTool(null);
												setPicking(
													!picking && placement.tool?.kind !== "image",
												);
											} else chooseTool(kind);
										}}
										className={`${WORKSPACE_TOGGLE_BUTTON_CLASS} ${placement.tool?.kind === kind || (kind === "image" && picking) || (!placement.tool && !picking && selectionActions?.kind === kind) ? "bg-accent-soft text-accent" : "text-text-2 hover:bg-input hover:text-text-1"}`}
									>
										<Icon size={18} strokeWidth={1.65} aria-hidden="true" />
									</button>
								</Tooltip>
							))}
					</div>
					{selectionActions && (
						<div className="ml-auto flex items-center gap-1 border-l border-border pl-2">
							<Tooltip>
								<button
									type="button"
									aria-label={t("comment")}
									title={t("comment")}
									disabled={
										Boolean(reason) || Boolean(placement.tool) || placement.busy
									}
									onPointerDown={(event) => event.preventDefault()}
									onClick={selectionActions.onComment}
									className={`${WORKSPACE_TOGGLE_BUTTON_CLASS} !h-7 !w-7 text-text-2 hover:bg-input hover:text-text-1`}
								>
									<MessageCircle
										size={14}
										strokeWidth={1.65}
										aria-hidden="true"
									/>
								</button>
							</Tooltip>
							<Tooltip>
								<button
									type="button"
									aria-label={t("hand_remove")}
									title={t("hand_remove")}
									disabled={
										!selectionActions.canRemove ||
										Boolean(reason) ||
										Boolean(placement.tool) ||
										placement.busy
									}
									onPointerDown={(event) => event.preventDefault()}
									onClick={() =>
										setDeletingElement(
											deletingElement === selectionActions.id
												? null
												: selectionActions.id,
										)
									}
									className={`${WORKSPACE_TOGGLE_BUTTON_CLASS} !h-7 !w-7 text-text-2 hover:bg-input hover:text-danger`}
								>
									<Trash2 size={14} strokeWidth={1.65} aria-hidden="true" />
								</button>
							</Tooltip>
						</div>
					)}
				</div>
				{picking && (
					<ComposerImagePicker
						anchorRef={imageButtonRef}
						onPick={(asset) => {
							revealComposerPage();
							setPicking(false);
							placement.setTool({ kind: "image", asset });
						}}
						onClose={() => setPicking(false)}
					/>
				)}
			</div>
			{selectionActions && deletingElement === selectionActions.id && (
				<HoldToDelete
					compact
					label={t("hand_delete_element")}
					onConfirm={() => {
						selectionActions.onRemove();
						setDeletingElement(null);
					}}
					onCancel={() => setDeletingElement(null)}
				/>
			)}
		</>
	);
}

function PlacedGeometry({
	doc,
	pageIndex,
	selection,
}: {
	doc: Document;
	pageIndex: number;
	selection: { id: string; box: PlacedBox };
}) {
	const t = useT();
	return (
		<InspectorSection label={t("hand_geometry")}>
			<div className="grid grid-cols-2 gap-2">
				{(["left", "top", "width", "height"] as const).map((key) => (
					<label key={key} className="text-sm text-text-2">
						{t(`hand_box_${key}`)}
						<input
							key={`${selection.id}:${selection.box[key]}`}
							type="number"
							step="0.1"
							aria-label={t(`hand_box_${key}`)}
							defaultValue={selection.box[key]}
							onBlur={(event) => {
								if (!event.currentTarget.value.trim()) return;
								const value = Number(event.currentTarget.value);
								if (!Number.isFinite(value) || value === selection.box[key])
									return;
								sendPlacedElementBox(
									doc.name,
									pageIndex,
									selection.id,
									clampPlacedBox(
										{ ...selection.box, [key]: value },
										doc.canvas.w,
										doc.canvas.h,
									),
								);
							}}
							className="mt-1.5 h-9 w-full rounded-md bg-input px-3 text-sm text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
						/>
					</label>
				))}
			</div>
		</InspectorSection>
	);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// UI adapter: document canvas changes are commands owned and validated by the WS store.
/** Canvas settings remain separate from the active placement tool. */
function PageOptions({
	doc,
	pageIndex,
	reason,
}: {
	doc: Document;
	pageIndex: number;
	reason?: string;
}) {
	const t = useT();
	const [deleting, setDeleting] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const changePage = async (remove: boolean) => {
		setBusy(true);
		setError(null);
		const result = await (remove
			? sendRemovePage(doc.name, doc.pages[pageIndex].id)
			: sendAddPage(doc.name));
		setBusy(false);
		setDeleting(false);
		if (result.ok) focusComposerPage(doc.name, result.pageId);
		else setError(result.error);
	};
	const format = doc.canvas.format ?? "A4";
	const orientation: Orientation =
		doc.canvas.orientation === "landscape" ? "landscape" : "portrait";
	const fixed = placedCompositionFormat(format);
	return (
		<section aria-label={t("hand_page_tools")} className="space-y-3">
			<div className="flex items-center gap-1.5">
				<div className="min-w-0 flex-1">
					<InspectorSelect
						label={t("hand_page")}
						value={doc.pages[pageIndex]?.id ?? ""}
						disabled={busy}
						onChange={(value) => focusComposerPage(doc.name, value)}
						options={doc.pages.map((page, index) => ({
							value: page.id,
							label: t("hand_page_number", { page: index + 1 }),
						}))}
					/>
				</div>
				<Tooltip>
					<button
						type="button"
						aria-label={t("hand_add_page")}
						title={t("hand_add_page")}
						disabled={Boolean(reason) || busy}
						className={PAGE_BUTTON}
						onClick={() => void changePage(false)}
					>
						<Plus size={16} strokeWidth={1.5} aria-hidden="true" />
					</button>
				</Tooltip>
				<Tooltip>
					<button
						type="button"
						aria-label={t("hand_delete_page")}
						title={
							doc.pages.length <= 1
								? t("hand_last_page")
								: t("hand_delete_page")
						}
						disabled={Boolean(reason) || busy || doc.pages.length <= 1}
						className={`${PAGE_BUTTON} hover:text-danger`}
						onClick={() => setDeleting(!deleting)}
					>
						<Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
					</button>
				</Tooltip>
			</div>
			{deleting && (
				<div className="mt-2">
					<HoldToDelete
						compact
						label={t("hand_confirm_delete_page")}
						onConfirm={() => void changePage(true)}
						onCancel={() => setDeleting(false)}
					/>
				</div>
			)}
			<fieldset
				disabled={Boolean(reason) || busy}
				className="grid min-w-0 grid-cols-2 gap-2 disabled:opacity-40"
			>
				<div className="min-w-0 space-y-1.5">
					<div className="text-sm text-text-2">{t("hand_format")}</div>
					<InspectorSelect
						label={t("hand_format")}
						value={format}
						disabled={Boolean(reason) || busy}
						onChange={(value) => sendCanvasFormat(doc.name, value, orientation)}
						options={[
							...(!fixed
								? [
										{
											value: format,
											label: t("hand_auto_format"),
											disabled: true,
										},
									]
								: []),
							...FIXED_FORMATS.map((name) => ({ value: name, label: name })),
						]}
					/>
				</div>
				<div className="min-w-0 space-y-1.5">
					<div className="text-sm text-text-2">{t("hand_orientation")}</div>
					<InspectorSelect
						label={t("hand_orientation")}
						value={orientation}
						disabled={
							Boolean(reason) || busy || !fixed || SCREEN_FORMATS.has(format)
						}
						onChange={(value) =>
							sendCanvasFormat(doc.name, format, value as Orientation)
						}
						options={[
							{ value: "portrait", label: t("hand_portrait") },
							{ value: "landscape", label: t("hand_landscape") },
						]}
					/>
				</div>
			</fieldset>
			{error && (
				<p role="alert" className="mt-2 text-sm text-danger">
					{error}
				</p>
			)}
		</section>
	);
}
