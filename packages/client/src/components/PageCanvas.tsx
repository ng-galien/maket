import {
	type Collection,
	markCollectionPlaceholders,
	readJsonPointer,
	resolveCollectionText,
} from "@maket/shared";
import { MessageCircle, Pencil } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useT } from "../i18n/useT";
import type { Document } from "../store/types";
import {
	hasPendingStatePatchForDocument,
	statePatchKey,
	useStore,
} from "../store/useStore";
import { sendStateValuePatch, sendTextEdit } from "../store/ws";
import {
	findStateEnumAnchor,
	StateEnumSelect,
	type StateEnumSelectState,
} from "./StateEnumSelect";

export function parseCSSVars(css: string): Record<string, string> {
	const vars: Record<string, string> = {};
	for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
		vars[match[1]] = match[2].trim();
	}
	return vars;
}

const NON_EDITABLE_TAGS = new Set(["img", "video", "canvas", "svg", "iframe"]);

function isTerminalStateValue(
	value: unknown,
): value is string | number | boolean | null {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

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

interface StateValueEditorState {
	pointer: string;
	type: "string" | "number" | "boolean" | "null";
	value: string | number | boolean | null;
	top: number;
	left: number;
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
	const textCommitRef = useRef(new WeakMap<HTMLInputElement, string>());
	const page = doc.pages[pageIndex];
	const stateBacked = doc.dataModel === "state";
	const stateView = useStore((s) => s.documentStates[doc.name]);
	const stateMode = useStore((s) => s.stateCanvasModes[doc.name] ?? "live");
	const statePatchPending = useStore((s) => s.statePatchPending);
	const statePatchErrors = useStore((s) => s.statePatchErrors);
	const stateDocumentPending = hasPendingStatePatchForDocument(
		statePatchPending,
		doc.name,
	);
	const liveState = stateBacked && stateMode === "live";
	const rawHtml =
		stateBacked && stateMode === "design"
			? (stateView?.templates[page?.id ?? ""] ?? page?.html ?? "")
			: (page?.html ?? "");
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
	const canInteract =
		!readOnly &&
		doc.meta?.locked !== true &&
		(!stateBacked || stateMode === "design");
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
	const [stateEditor, setStateEditor] = useState<StateValueEditorState | null>(
		null,
	);
	const [enumEditor, setEnumEditor] = useState<StateEnumSelectState | null>(
		null,
	);

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

	const activateStateButton = useCallback(
		(target: HTMLElement) => {
			if (!stateView || readOnly || doc.meta?.locked === true) return;
			const pointer = target.dataset.maketPath;
			const type = target.dataset.maketType;
			if (!pointer || !type) return;
			if (stateDocumentPending) return;
			let value: unknown;
			try {
				value = readJsonPointer(stateView.data, pointer);
			} catch {
				return;
			}
			if (
				type !== "string" &&
				type !== "number" &&
				type !== "boolean" &&
				type !== "null"
			)
				return;
			const rect = target.getBoundingClientRect();
			setStateEditor({
				pointer,
				type,
				value: isTerminalStateValue(value) ? value : null,
				top: Math.min(window.innerHeight - 128, rect.bottom + 8),
				left: Math.min(window.innerWidth - 292, Math.max(12, rect.left)),
			});
		},
		[doc.meta?.locked, readOnly, stateDocumentPending, stateView],
	);

	const authoritativeStateValue = useCallback(
		(pointer: string): unknown => {
			try {
				return readJsonPointer(stateView?.data ?? {}, pointer);
			} catch {
				return undefined;
			}
		},
		[stateView?.data],
	);

	const commitStateStringValue = useCallback(
		(pointer: string, value: string): "sent" | "unchanged" | "restored" => {
			if (!stateView) return "restored";
			if (readOnly) return "unchanged";
			const authoritative = authoritativeStateValue(pointer);
			if (
				doc.meta?.locked === true ||
				stateDocumentPending ||
				typeof authoritative !== "string"
			)
				return "restored";
			if (value === authoritative) return "unchanged";
			useStore.getState().setFocusedPage(doc.name, pageIndex);
			const requestId = sendStateValuePatch(
				doc.name,
				pointer,
				stateView.revision,
				value,
			);
			if (!requestId) return "restored";
			setStateEditor(null);
			return "sent";
		},
		[
			authoritativeStateValue,
			doc.meta?.locked,
			doc.name,
			pageIndex,
			readOnly,
			stateDocumentPending,
			stateView,
		],
	);

	const activateStateEnum = useCallback(
		(select: HTMLSelectElement) => {
			if (
				!stateView ||
				readOnly ||
				doc.meta?.locked === true ||
				stateDocumentPending
			)
				return;
			useStore.getState().setFocusedPage(doc.name, pageIndex);
			const pointer = select.dataset.maketPath;
			if (!pointer || select.dataset.maketType !== "string") return;
			const authoritative = authoritativeStateValue(pointer);
			if (typeof authoritative !== "string") return;
			const options = Array.from(select.options)
				.filter((option) => !option.disabled)
				.map((option) => ({
					value: option.value,
					label: option.label || option.textContent || option.value,
				}));
			if (options.length === 0) return;
			const anchorIndex = Array.from(
				pageRef.current?.querySelectorAll<HTMLSelectElement>(
					"select[data-maket-bind][data-maket-path]",
				) ?? [],
			)
				.filter((candidate) => candidate.dataset.maketPath === pointer)
				.indexOf(select);
			if (anchorIndex < 0) return;
			const anchorRect = select.getBoundingClientRect();
			setEnumEditor({
				pointer,
				anchorIndex,
				anchorRect: {
					top: anchorRect.top,
					bottom: anchorRect.bottom,
					left: anchorRect.left,
					width: anchorRect.width,
				},
				options,
				selectedValue: authoritative,
				label: stateSelectLabel(select, t("state_value")),
			});
		},
		[
			authoritativeStateValue,
			doc.meta?.locked,
			doc.name,
			pageIndex,
			readOnly,
			stateDocumentPending,
			stateView,
			t,
		],
	);

	useEffect(() => {
		const canvas = pageRef.current;
		if (!canvas || !liveState) return;
		canvas.toggleAttribute("inert", stateDocumentPending);
		return () => canvas.removeAttribute("inert");
	}, [liveState, stateDocumentPending]);

	useEffect(() => {
		if (!pageRef.current || !liveState) return;
		const el = pageRef.current;
		const restoreControl = (
			binding: HTMLInputElement | HTMLSelectElement,
			pointer: string,
		) => {
			const authoritative = authoritativeStateValue(pointer);
			if (binding instanceof HTMLSelectElement) {
				if (typeof authoritative === "string") binding.value = authoritative;
				return;
			}
			if (binding.type === "checkbox") {
				if (typeof authoritative === "boolean") {
					binding.checked = authoritative;
				}
				return;
			}
			if (binding.type === "text" && typeof authoritative === "string") {
				binding.value = authoritative;
			}
		};
		const commitStringControl = (
			binding: HTMLInputElement | HTMLSelectElement,
		): "sent" | "unchanged" | "restored" => {
			const pointer = binding.dataset.maketPath;
			if (!pointer) return "restored";
			const result = commitStateStringValue(pointer, binding.value);
			if (result === "restored") {
				restoreControl(binding, pointer);
			}
			return result;
		};
		const onPointerDown = (event: PointerEvent) => {
			if (event.button !== 0) return;
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			const select = target.closest(
				"select[data-maket-bind][data-maket-path]",
			) as HTMLSelectElement | null;
			if (!select) return;
			event.preventDefault();
			event.stopPropagation();
			select.focus({ preventScroll: true });
			activateStateEnum(select);
		};
		const onClick = (event: MouseEvent) => {
			const binding = (event.target as HTMLElement).closest(
				'button[type="button"][data-maket-bind][data-maket-path]',
			) as HTMLButtonElement | null;
			if (!binding) return;
			event.preventDefault();
			event.stopPropagation();
			useStore.getState().setFocusedPage(doc.name, pageIndex);
			activateStateButton(binding);
		};
		const onChange = (event: Event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement) || !stateView) return;
			const binding = target.closest(
				'input[type="checkbox"][data-maket-bind][data-maket-path], input[type="text"][data-maket-bind][data-maket-path], select[data-maket-bind][data-maket-path]',
			) as HTMLInputElement | HTMLSelectElement | null;
			if (!binding) return;
			const pointer = binding.dataset.maketPath;
			if (!pointer) return;
			if (
				binding instanceof HTMLInputElement &&
				binding.type === "text" &&
				textCommitRef.current.get(binding) === binding.value
			) {
				textCommitRef.current.delete(binding);
				return;
			}
			if (
				binding instanceof HTMLSelectElement ||
				(binding instanceof HTMLInputElement && binding.type === "text")
			) {
				commitStringControl(binding);
				return;
			}
			if (readOnly) return;
			if (doc.meta?.locked === true) {
				restoreControl(binding, pointer);
				return;
			}
			if (stateDocumentPending) {
				restoreControl(binding, pointer);
				return;
			}
			if (!(binding instanceof HTMLInputElement)) return;
			useStore.getState().setFocusedPage(doc.name, pageIndex);
			const requestId = sendStateValuePatch(
				doc.name,
				pointer,
				stateView.revision,
				binding.checked,
			);
			if (!requestId) {
				restoreControl(binding, pointer);
				return;
			}
			setStateEditor(null);
		};
		const onInput = (event: Event) => {
			const target = event.target;
			if (target instanceof HTMLInputElement && target.type === "text") {
				textCommitRef.current.delete(target);
			}
		};
		const onKeyDown = (event: KeyboardEvent) =>
			handleLiveControlKeyDown(event, {
				activateEnum: activateStateEnum,
				commitString: commitStringControl,
				restore: restoreControl,
				textCommits: textCommitRef.current,
			});
		el.addEventListener("pointerdown", onPointerDown);
		el.addEventListener("click", onClick);
		el.addEventListener("change", onChange);
		el.addEventListener("input", onInput);
		el.addEventListener("keydown", onKeyDown);
		return () => {
			el.removeEventListener("pointerdown", onPointerDown);
			el.removeEventListener("click", onClick);
			el.removeEventListener("change", onChange);
			el.removeEventListener("input", onInput);
			el.removeEventListener("keydown", onKeyDown);
		};
	}, [
		activateStateEnum,
		activateStateButton,
		authoritativeStateValue,
		commitStateStringValue,
		doc.meta?.locked,
		doc.name,
		liveState,
		pageIndex,
		readOnly,
		stateDocumentPending,
		statePatchPending,
		stateView,
	]);

	useEffect(() => {
		if (!pageRef.current || !liveState) return;
		pageRef.current
			.querySelectorAll<HTMLElement>("[data-maket-bind][data-maket-path]")
			.forEach((binding) => {
				const pointer = binding.dataset.maketPath;
				const key = pointer ? statePatchKey(doc.name, pointer) : "";
				const isPending = Boolean(key && statePatchPending[key]);
				const error = key ? statePatchErrors[key] : undefined;
				binding.toggleAttribute("data-maket-pending", isPending);
				binding.setAttribute("aria-busy", String(isPending));
				if (binding instanceof HTMLSelectElement) {
					binding.setAttribute("aria-haspopup", "listbox");
					binding.setAttribute("aria-expanded", "false");
					binding.setAttribute(
						"aria-disabled",
						String(
							readOnly || doc.meta?.locked === true || stateDocumentPending,
						),
					);
				}
				if (error) binding.setAttribute("data-maket-error", error);
				else binding.removeAttribute("data-maket-error");
				if (error && pointer) {
					const authoritative = readJsonPointer(stateView?.data ?? {}, pointer);
					if (
						binding instanceof HTMLInputElement &&
						binding.type === "checkbox" &&
						typeof authoritative === "boolean"
					) {
						binding.checked = authoritative;
					}
					if (
						binding instanceof HTMLInputElement &&
						binding.type === "text" &&
						typeof authoritative === "string"
					) {
						binding.value = authoritative;
					}
					if (
						binding instanceof HTMLSelectElement &&
						typeof authoritative === "string"
					) {
						binding.value = authoritative;
					}
				}
			});
	}, [
		doc.name,
		doc.meta?.locked,
		liveState,
		readOnly,
		renderHtml,
		statePatchErrors,
		statePatchPending,
		stateDocumentPending,
		stateView?.data,
	]);

	useEffect(() => {
		setStateEditor(null);
		setEnumEditor(null);
	}, [stateMode, stateView?.revision]);

	const dismissEnumEditor = useCallback(
		(restoreFocus: boolean) => {
			if (!enumEditor) return;
			const { pointer, anchorIndex } = enumEditor;
			flushSync(() => setEnumEditor(null));
			if (restoreFocus && pageRef.current)
				findStateEnumAnchor(pageRef.current, {
					pointer,
					anchorIndex,
				})?.focus({ preventScroll: true });
		},
		[enumEditor],
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
				className={`page-canvas${preview?.mode === "rendered" || liveState ? " data-preview" : ""}${liveState ? " state-live" : ""}`}
				data-page={pageIndex}
				data-document-mode={doc.dataModel}
				aria-busy={liveState ? stateDocumentPending : undefined}
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
								{!stateBacked && (
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
								)}
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
			{stateEditor &&
				stateView &&
				createPortal(
					<StateValueEditor
						state={stateEditor}
						onCancel={() => setStateEditor(null)}
						onSubmit={(value) => {
							if (stateDocumentPending) return;
							const requestId = sendStateValuePatch(
								doc.name,
								stateEditor.pointer,
								stateView.revision,
								value,
							);
							if (requestId) setStateEditor(null);
						}}
					/>,
					document.body,
				)}
			{enumEditor &&
				pageRef.current &&
				createPortal(
					<StateEnumSelect
						state={enumEditor}
						root={pageRef.current}
						onCancel={dismissEnumEditor}
						onSubmit={(value) => {
							const result = commitStateStringValue(enumEditor.pointer, value);
							if (result !== "restored") dismissEnumEditor(true);
						}}
					/>,
					document.body,
				)}
		</>
	);
});

interface LiveControlKeyContext {
	activateEnum: (select: HTMLSelectElement) => void;
	commitString: (
		binding: HTMLInputElement | HTMLSelectElement,
	) => "sent" | "unchanged" | "restored";
	restore: (
		binding: HTMLInputElement | HTMLSelectElement,
		pointer: string,
	) => void;
	textCommits: WeakMap<HTMLInputElement, string>;
}

function handleLiveControlKeyDown(
	event: KeyboardEvent,
	context: LiveControlKeyContext,
): void {
	if (handleEnumControlKeyDown(event, context.activateEnum)) return;
	handleTextControlKeyDown(event, context);
}

function handleEnumControlKeyDown(
	event: KeyboardEvent,
	activate: (select: HTMLSelectElement) => void,
): boolean {
	const target = event.target;
	if (
		!(target instanceof HTMLSelectElement) ||
		!target.matches("[data-maket-bind][data-maket-path]") ||
		(event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown")
	)
		return false;
	event.preventDefault();
	event.stopPropagation();
	activate(target);
	return true;
}

function handleTextControlKeyDown(
	event: KeyboardEvent,
	context: LiveControlKeyContext,
): void {
	const target = event.target;
	if (
		!(target instanceof HTMLInputElement) ||
		target.type !== "text" ||
		!target.matches("[data-maket-bind][data-maket-path]")
	)
		return;
	event.stopPropagation();
	const pointer = target.dataset.maketPath;
	if (!pointer) return;
	if (event.key === "Escape") {
		event.preventDefault();
		context.textCommits.delete(target);
		context.restore(target, pointer);
		return;
	}
	if (event.key !== "Enter") return;
	event.preventDefault();
	const result = context.commitString(target);
	if (result !== "restored") context.textCommits.set(target, target.value);
}

function stateSelectLabel(select: HTMLSelectElement, fallback: string): string {
	if (select.getAttribute("aria-label"))
		return select.getAttribute("aria-label") ?? "";
	const label = select.labels?.[0];
	if (label) {
		const copy = label.cloneNode(true) as HTMLLabelElement;
		copy.querySelectorAll("select").forEach((element) => {
			element.remove();
		});
		if (copy.textContent?.trim()) return copy.textContent.trim();
	}
	return fallback;
}

function StateValueEditor({
	state,
	onCancel,
	onSubmit,
}: {
	state: StateValueEditorState;
	onCancel: () => void;
	onSubmit: (value: string | number | boolean | null) => void;
}) {
	const t = useT();
	const [value, setValue] = useState(
		typeof state.value === "string" || typeof state.value === "number"
			? String(state.value)
			: "",
	);
	const [booleanValue, setBooleanValue] = useState(state.value === true);
	const [invalid, setInvalid] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onCancel();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onCancel]);

	return (
		<form
			data-state-value-editor
			aria-label={t("state_edit_value")}
			className="fixed z-[var(--z-popover)] w-[280px] rounded-xl border border-border bg-panel p-3 shadow-[0_16px_48px_rgba(0,0,0,0.18)]"
			style={{ top: state.top, left: state.left }}
			onSubmit={(event) => {
				event.preventDefault();
				if (state.type === "number") {
					const number = Number(value);
					if (value.trim() === "" || !Number.isFinite(number)) {
						setInvalid(true);
						return;
					}
					onSubmit(number);
					return;
				}
				if (state.type === "boolean") {
					onSubmit(booleanValue);
					return;
				}
				if (state.type === "null") {
					onSubmit(null);
					return;
				}
				onSubmit(value);
			}}
		>
			<label
				className="mb-1.5 block text-xs font-semibold text-text-2"
				htmlFor="maket-state-value"
			>
				{t("state_value")}
			</label>
			{state.type === "boolean" ? (
				<input
					ref={inputRef}
					id="maket-state-value"
					type="checkbox"
					checked={booleanValue}
					onChange={(event) => setBooleanValue(event.target.checked)}
					className="size-5 accent-accent"
				/>
			) : state.type === "null" ? (
				<input
					ref={inputRef}
					id="maket-state-value"
					type="text"
					value="null"
					readOnly
					className="h-9 w-full rounded-lg border border-border bg-input px-3 font-mono text-sm text-text-1 outline-none"
				/>
			) : (
				<input
					ref={inputRef}
					id="maket-state-value"
					type={state.type === "number" ? "number" : "text"}
					step="any"
					value={value}
					onChange={(event) => {
						setValue(event.target.value);
						setInvalid(false);
					}}
					aria-invalid={invalid}
					className="h-9 w-full rounded-lg border border-border bg-input px-3 text-sm text-text-1 outline-none focus:border-accent"
				/>
			)}
			{invalid && (
				<p className="mt-1 text-xs text-danger">{t("state_invalid_number")}</p>
			)}
			<div className="mt-3 flex justify-end gap-2">
				<button
					type="button"
					onClick={onCancel}
					className="h-8 rounded-lg px-3 text-xs font-semibold text-text-2 hover:bg-input"
				>
					{t("cancel")}
				</button>
				<button
					type="submit"
					className="h-8 rounded-lg bg-accent px-3 text-xs font-semibold text-white hover:brightness-95"
				>
					{t("save")}
				</button>
			</div>
		</form>
	);
}
