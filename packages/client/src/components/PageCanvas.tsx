import {
	type Collection,
	markCollectionPlaceholders,
	resolveCollectionText,
} from "@maket/shared";
import { MessageCircle, Pencil } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { sendTextEdit } from "../store/ws";

export function parseCSSVars(css: string): Record<string, string> {
	const vars: Record<string, string> = {};
	for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
		vars[match[1]] = match[2].trim();
	}
	return vars;
}

const NON_EDITABLE_TAGS = new Set(["img", "video", "canvas", "svg", "iframe"]);

export function isTextEditable(el: HTMLElement): boolean {
	if (NON_EDITABLE_TAGS.has(el.tagName.toLowerCase())) return false;
	if (el.dataset.noedit !== undefined) return false;
	const hasDirectText = [...el.childNodes].some(
		(n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
	);
	const hasNonIdChildren = [...el.children].some(
		(c) => !(c as HTMLElement).dataset?.id,
	);
	if (!hasDirectText && !hasNonIdChildren && el.children.length > 0)
		return false;
	return true;
}

function collectionPreviewHtml(
	rawHtml: string,
	hasCollection: boolean,
	collection: Collection | null,
	collectionName: string | undefined,
	preview: CollectionPagePreview | undefined,
): { html: string; error: string | null } {
	if (!hasCollection) return { html: rawHtml, error: null };
	if (!collection) {
		return {
			...markedTemplateHtml(rawHtml, null),
			error: `Collection "${collectionName ?? ""}" not found.`,
		};
	}
	if (preview?.mode === "rendered" && collection) {
		const member = collection.members.find(
			(candidate) => candidate.id === preview.memberId,
		);
		if (member) {
			try {
				return {
					html: resolveCollectionText(rawHtml, collection, {
						member,
						memberNumber: preview.memberNumber,
						memberTotal: preview.memberTotal,
						pageNumber: preview.pageNumber,
						pageTotal: preview.pageTotal,
					}),
					error: null,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					html: markedTemplateHtml(rawHtml, collection).html,
					error: message,
				};
			}
		}
	}
	return markedTemplateHtml(rawHtml, collection);
}

/** Mark placeholders for template display. A template Mustache cannot parse
 * is surfaced as an error instead of silently losing its markers. */
function markedTemplateHtml(
	rawHtml: string,
	collection: Collection | null,
): { html: string; error: string | null } {
	try {
		return {
			html: markCollectionPlaceholders(rawHtml, collection ?? undefined),
			error: null,
		};
	} catch (error) {
		return {
			html: rawHtml,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

interface Props {
	doc: Document;
	pageIndex: number;
	charteCss: string;
	focused: boolean;
	collection?: Collection | null;
	preview?: CollectionPagePreview;
}

export interface CollectionPagePreview {
	mode: "template" | "rendered";
	memberId: string | null;
	memberNumber: number;
	memberTotal: number;
	pageNumber: number;
	pageTotal: number;
}

/** Toolbar position in screen (viewport) coordinates */
interface ToolbarState {
	id: string;
	screenTop: number;
	screenRight: number;
	editable: boolean;
}

export const PageCanvas = memo(function PageCanvas({
	doc,
	pageIndex,
	charteCss,
	focused,
	collection = null,
	preview,
}: Props) {
	const t = useT();
	const pageRef = useRef<HTMLDivElement>(null);
	const editingRef = useRef<{
		id: string;
		originalHtml: string;
		target: HTMLElement;
	} | null>(null);
	const page = doc.pages[pageIndex];
	const rawHtml = page?.html ?? "";
	const collectionRender = useMemo(() => {
		return collectionPreviewHtml(
			rawHtml,
			Boolean(page?.collection),
			collection,
			page?.collection?.name,
			preview,
		);
	}, [collection, page?.collection, preview, rawHtml]);
	const html = useMemo(
		() =>
			collectionRender.html.replace(
				/src=["']\/assets\/(?!(?:thumb|preview|print)\/)([\w.\-()% ]+\.(jpe?g|png|webp))["']/gi,
				'src="/assets/preview/$1"',
			),
		[collectionRender.html],
	);
	const { canvas } = doc;
	const pending = useStore((s) => s.pending);
	const isEditing = useStore((s) => s.editingElementId !== null);
	const readOnly = useStore((s) => s.readOnly);
	const stateBacked = doc.dataModel === "state";
	const canInteract = !readOnly && !stateBacked;
	const canEditTemplate = canInteract && preview?.mode !== "rendered";
	const charteVars = useMemo(() => parseCSSVars(charteCss), [charteCss]);
	const placeholderOptions = useMemo(
		() => [
			...(collection
				? Object.keys(collection.schema.properties ?? {}).map((key) => ({
						label: key,
						value: key,
					}))
				: []),
			{ label: "page.number", value: "page.number" },
			{ label: "page.total", value: "page.total" },
			...(collection
				? [
						{ label: "member.number", value: "member.number" },
						{ label: "member.total", value: "member.total" },
					]
				: []),
		],
		[collection],
	);

	const stableHtmlRef = useRef(html);
	if (!isEditing) stableHtmlRef.current = html;
	const renderHtml = isEditing ? stableHtmlRef.current : html;

	useEffect(() => {
		if (!isEditing) return;
		stableHtmlRef.current = html;
		useStore.getState().setEditingElement(null);
	}, [rawHtml]);

	const [toolbar, setToolbar] = useState<ToolbarState | null>(null);

	const dismissToolbar = useCallback(() => setToolbar(null), []);

	useEffect(() => {
		if (!toolbar) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") dismissToolbar();
		};
		const onClick = (e: MouseEvent) => {
			const t = e.target as HTMLElement;
			if (t.closest(".element-toolbar")) return;
			if (t.closest(".page-canvas")) return;
			dismissToolbar();
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener("click", onClick, true);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("click", onClick, true);
		};
	}, [toolbar, dismissToolbar]);

	const startEdit = useCallback(
		(id: string) => {
			if (!pageRef.current || !canEditTemplate) return;

			const origTarget = pageRef.current.querySelector(
				`[data-id="${id}"]`,
			) as HTMLElement | null;
			if (!origTarget) return;
			const originalHtml = origTarget.innerHTML;

			useStore.getState().setEditingElement(id);
			useStore.getState().selectElement(id);

			requestAnimationFrame(() => {
				if (!pageRef.current) return;
				const target = pageRef.current.querySelector(
					`[data-id="${id}"]`,
				) as HTMLElement | null;
				if (!target) return;

				editingRef.current = { id, originalHtml, target };
				pageRef.current.classList.add("is-editing");

				target.contentEditable = "true";
				target.focus();
				const range = document.createRange();
				range.selectNodeContents(target);
				range.collapse(false);
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);

				const onKeyDown = (ke: KeyboardEvent) => {
					if (ke.key === "Escape") {
						ke.preventDefault();
						target.removeEventListener("blur", onBlur);
						exitEdit(false);
					}
					if (ke.code === "Space") ke.stopPropagation();
				};
				const onBlur = () => {
					exitEdit(true);
				};
				const onPaste = (pe: ClipboardEvent) => {
					pe.preventDefault();
					const text = pe.clipboardData?.getData("text/plain") ?? "";
					const s = window.getSelection();
					if (!s?.rangeCount) return;
					const r = s.getRangeAt(0);
					r.deleteContents();
					r.insertNode(document.createTextNode(text));
					r.collapse(false);
					s.removeAllRanges();
					s.addRange(r);
				};

				target.addEventListener("keydown", onKeyDown);
				target.addEventListener("paste", onPaste as EventListener);
				requestAnimationFrame(() => target.addEventListener("blur", onBlur));

				(target as any).__editCleanup = () => {
					target.removeEventListener("keydown", onKeyDown);
					target.removeEventListener("blur", onBlur);
					target.removeEventListener("paste", onPaste as EventListener);
				};
			});
		},
		[canEditTemplate],
	);

	function exitEdit(commit: boolean) {
		const state = editingRef.current;
		if (!state) return;
		const { target, id, originalHtml } = state;

		target.contentEditable = "false";
		(target as any).__editCleanup?.();
		pageRef.current?.classList.remove("is-editing");

		if (commit) {
			const newHtml = target.innerHTML;
			if (newHtml !== originalHtml) {
				sendTextEdit(doc.name, pageIndex, id, newHtml);
			} else {
				useStore.getState().setEditingElement(null);
			}
		} else {
			target.innerHTML = originalHtml;
			useStore.getState().setEditingElement(null);
		}

		editingRef.current = null;
	}

	const openComment = useCallback(
		(id: string) => {
			dismissToolbar();
			useStore.getState().selectElement(id);
			useStore.setState({ showPopover: true });
		},
		[dismissToolbar],
	);

	const applyPlaceholder = useCallback(
		(id: string, placeholder: string) => {
			if (!placeholder || !pageRef.current) return;
			const target = pageRef.current.querySelector(
				`[data-id="${id}"]`,
			) as HTMLElement | null;
			if (!target) return;
			sendTextEdit(doc.name, pageIndex, id, `{{ ${placeholder} }}`);
			setToolbar(null);
		},
		[doc.name, pageIndex],
	);

	useEffect(() => {
		if (!pageRef.current || !focused || !canInteract) return;
		const el = pageRef.current;

		const onClick = (e: MouseEvent) => {
			if ((e.target as HTMLElement).closest(".element-toolbar")) return;
			if (editingRef.current) return;
			const target = (e.target as HTMLElement).closest(
				"[data-id]",
			) as HTMLElement | null;
			if (!target) return;
			e.stopPropagation();
			const id = target.dataset.id;
			if (!id) return;

			useStore.getState().setFocusedPage(doc.name, pageIndex);
			const docRoot = el.closest("[data-doc]");
			if (docRoot) {
				docRoot.querySelectorAll("[data-id].selected").forEach((e) => {
					(e as HTMLElement).classList.remove("selected");
				});
			}

			if (toolbar?.id === id) {
				useStore.getState().selectElement(null);
				setToolbar(null);
				return;
			}

			target.classList.add("selected");
			useStore.getState().selectElement(id);
			const rect = target.getBoundingClientRect();
			setToolbar({
				id,
				screenTop: rect.top,
				screenRight: window.innerWidth - rect.right,
				editable: canEditTemplate && isTextEditable(target),
			});
		};

		el.addEventListener("click", onClick);
		return () => {
			if (editingRef.current) exitEdit(false);
			el.removeEventListener("click", onClick);
		};
	}, [
		html,
		focused,
		toolbar?.id,
		canEditTemplate,
		canInteract,
		doc.name,
		pageIndex,
	]);

	useEffect(() => {
		if (!pageRef.current) return;
		const deleteIds = new Set(
			pending.filter((m) => m.type === "delete").map((m) => m.elementId),
		);
		const noteIds = new Set(
			pending.filter((m) => m.type === "note").map((m) => m.elementId),
		);
		pageRef.current.querySelectorAll("[data-id]").forEach((el) => {
			const id = (el as HTMLElement).dataset.id;
			if (!id) return;
			el.classList.toggle("flagged-delete", deleteIds.has(id));
			el.classList.toggle("has-note", noteIds.has(id));
		});
	}, [pending, renderHtml]);

	const margins = canvas.margins;

	return (
		<>
			<div
				ref={pageRef}
				className={`page-canvas${preview?.mode === "rendered" || stateBacked ? " data-preview" : ""}`}
				data-page={pageIndex}
				data-document-mode={doc.dataModel}
				style={{
					width: `${canvas.w}mm`,
					height: `${canvas.h}mm`,
					background: "var(--charte-color-bg, #ffffff)",
					containIntrinsicSize: `${canvas.w}mm ${canvas.h}mm`,
					position: "relative",
					lineHeight: "normal",
					fontFamily: "initial",
					...charteVars,
				}}
			>
				<div
					dangerouslySetInnerHTML={{ __html: renderHtml }}
					style={{ width: "100%", height: "100%" }}
				/>
				{margins && (
					<div
						className="margin-guide"
						style={{
							position: "absolute",
							top: `${margins.top}mm`,
							right: `${margins.right}mm`,
							bottom: `${margins.bottom}mm`,
							left: `${margins.left}mm`,
							border: "1px dashed rgba(0,180,220,0.7)",
							pointerEvents: "none",
							zIndex: 9999,
						}}
					/>
				)}
				{collectionRender.error && (
					<div className="absolute top-2 left-2 right-2 z-[10000] rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] font-semibold text-danger shadow-sm">
						{t("collection_preview_error")}: {collectionRender.error}
					</div>
				)}
			</div>
			{toolbar &&
				!isEditing &&
				createPortal(
					<div
						className="element-toolbar"
						style={{
							position: "fixed",
							top: toolbar.screenTop - 30,
							right: toolbar.screenRight,
						}}
					>
						{toolbar.editable && (
							<>
								<button
									type="button"
									className="tb-btn tb-edit"
									title={t("edit_text")}
									aria-label={t("edit_text")}
									onClick={(e) => {
										e.stopPropagation();
										startEdit(toolbar.id);
									}}
								>
									<Pencil size={12} />
								</button>
								<select
									title={t("collection_use_placeholder")}
									aria-label={t("collection_use_placeholder")}
									defaultValue=""
									onClick={(e) => e.stopPropagation()}
									onChange={(event) =>
										applyPlaceholder(toolbar.id, event.target.value)
									}
									className="h-7 max-w-36 rounded-md bg-panel border border-border text-xs text-text-2 px-2 outline-none"
								>
									<option value="">{t("collection_placeholder")}</option>
									{placeholderOptions.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</>
						)}
						<button
							type="button"
							className="tb-btn tb-comment"
							title={t("comment")}
							aria-label={t("comment")}
							onClick={(e) => {
								e.stopPropagation();
								openComment(toolbar.id);
							}}
						>
							<MessageCircle size={12} />
						</button>
					</div>,
					document.body,
				)}
		</>
	);
});
