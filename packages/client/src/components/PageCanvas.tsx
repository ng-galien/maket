import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

interface Props {
	doc: Document;
	pageIndex: number;
	charteCss: string;
	focused: boolean;
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
}: Props) {
	const pageRef = useRef<HTMLDivElement>(null);
	const editingRef = useRef<{
		id: string;
		originalHtml: string;
		target: HTMLElement;
	} | null>(null);
	const page = doc.pages[pageIndex];
	const rawHtml = page?.html ?? "";
	const html = useMemo(
		() =>
			rawHtml.replace(
				/src=["']\/assets\/(?!(?:thumb|preview|print)\/)([\w.\-()% ]+\.(jpe?g|png|webp))["']/gi,
				'src="/assets/preview/$1"',
			),
		[rawHtml],
	);
	const { canvas } = doc;
	const pending = useStore((s) => s.pending);
	const isEditing = useStore((s) => s.editingElementId !== null);
	const charteVars = useMemo(() => parseCSSVars(charteCss), [charteCss]);

	// Freeze rendered HTML during editing to protect contentEditable DOM.
	// When server broadcast arrives with updated rawHtml, clear editing.
	const stableHtmlRef = useRef(html);
	if (!isEditing) stableHtmlRef.current = html;
	const renderHtml = isEditing ? stableHtmlRef.current : html;

	useEffect(() => {
		if (!isEditing) return;
		// Server broadcast arrived with new HTML — editing is done
		stableHtmlRef.current = html;
		useStore.getState().setEditingElement(null);
	}, [rawHtml]);

	// Element toolbar — pinned on click
	const [toolbar, setToolbar] = useState<ToolbarState | null>(null);

	const dismissToolbar = useCallback(() => setToolbar(null), []);

	// Dismiss on Escape or click outside
	useEffect(() => {
		if (!toolbar) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") dismissToolbar();
		};
		const onClick = (e: MouseEvent) => {
			const t = e.target as HTMLElement;
			console.log(
				"[toolbar dismiss] click target:",
				t.tagName,
				t.className,
				"closest toolbar:",
				!!t.closest(".element-toolbar"),
				"closest canvas:",
				!!t.closest(".page-canvas"),
			);
			if (t.closest(".element-toolbar")) return;
			if (t.closest(".page-canvas")) return;
			console.log("[toolbar dismiss] → dismissing");
			dismissToolbar();
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener("click", onClick, true);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("click", onClick, true);
		};
	}, [toolbar, dismissToolbar]);

	// Edit actions
	const startEdit = useCallback(
		(id: string) => {
			console.log("[startEdit] called with id:", id);
			if (!pageRef.current) {
				console.error("[startEdit] FAIL: no pageRef");
				return;
			}

			// Save original HTML before React re-renders
			const origTarget = pageRef.current.querySelector(
				`[data-id="${id}"]`,
			) as HTMLElement | null;
			if (!origTarget) {
				console.error("[startEdit] FAIL: element not found:", id);
				return;
			}
			const originalHtml = origTarget.innerHTML;

			// Trigger state change — React will re-render and freeze displayHtml
			useStore.getState().setEditingElement(id);
			useStore.getState().selectElement(id);

			// After React re-render, find the element again and activate contentEditable
			requestAnimationFrame(() => {
				if (!pageRef.current) return;
				const target = pageRef.current.querySelector(
					`[data-id="${id}"]`,
				) as HTMLElement | null;
				if (!target) {
					console.error("[startEdit] FAIL: element gone after re-render:", id);
					return;
				}

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
				console.log("[startEdit] editing active on", id);

				const onKeyDown = (ke: KeyboardEvent) => {
					if (ke.key === "Escape") {
						ke.preventDefault();
						target.removeEventListener("blur", onBlur);
						exitEdit(false);
					}
					if (ke.code === "Space") ke.stopPropagation();
				};
				const onBlur = () => {
					console.log("[edit] blur → exitEdit(true)");
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
				// Attach blur after focus settles
				requestAnimationFrame(() => target.addEventListener("blur", onBlur));

				(target as any).__editCleanup = () => {
					target.removeEventListener("keydown", onKeyDown);
					target.removeEventListener("blur", onBlur);
					target.removeEventListener("paste", onPaste as EventListener);
				};
			});
		},
		[doc.name],
	);

	function exitEdit(commit: boolean) {
		const state = editingRef.current;
		if (!state) {
			console.error("[exitEdit] FAIL: no editingRef.current");
			return;
		}
		const { target, id, originalHtml } = state;
		console.log(
			"[exitEdit] commit:",
			commit,
			"id:",
			id,
			"target in DOM:",
			document.contains(target),
		);

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

	// Open comment popover — dismiss toolbar, show popover
	const openComment = useCallback(
		(id: string) => {
			dismissToolbar();
			useStore.getState().selectElement(id);
			useStore.setState({ showPopover: true });
		},
		[dismissToolbar],
	);

	// Click delegation — pin toolbar on clicked element
	useEffect(() => {
		if (!pageRef.current || !focused) return;
		const el = pageRef.current;

		const onClick = (e: MouseEvent) => {
			console.log(
				"[canvas click] target:",
				(e.target as HTMLElement).tagName,
				"closest toolbar:",
				!!(e.target as HTMLElement).closest(".element-toolbar"),
				"editing:",
				!!editingRef.current,
			);
			if ((e.target as HTMLElement).closest(".element-toolbar")) return;
			if (editingRef.current) return;
			const target = (e.target as HTMLElement).closest(
				"[data-id]",
			) as HTMLElement | null;
			if (!target) return;
			e.stopPropagation();
			const id = target.dataset.id;
			if (!id) return;
			console.log(
				"[canvas click] element id:",
				id,
				"toolbar?.id:",
				toolbar?.id,
			);

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
				editable: isTextEditable(target),
			});
		};

		el.addEventListener("click", onClick);
		return () => {
			if (editingRef.current) exitEdit(false);
			el.removeEventListener("click", onClick);
		};
	}, [html, focused, doc.name, toolbar?.id]);

	// Sync pending flags on DOM elements
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
				className="page-canvas"
				data-page={pageIndex}
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
			</div>
			{/* Pinned toolbar — rendered outside canvas via portal (zoom-independent) */}
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
							<button
								type="button"
								className="tb-btn tb-edit"
								title="Edit text"
								onClick={(e) => {
									e.stopPropagation();
									console.log("[toolbar] ✏️ clicked, id:", toolbar.id);
									startEdit(toolbar.id);
								}}
							>
								<svg
									aria-hidden="true"
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
								</svg>
							</button>
						)}
						<button
							type="button"
							className="tb-btn tb-comment"
							title="Comment"
							onClick={(e) => {
								e.stopPropagation();
								console.log("[toolbar] 💬 clicked, id:", toolbar.id);
								openComment(toolbar.id);
							}}
						>
							<svg
								aria-hidden="true"
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
							</svg>
						</button>
					</div>,
					document.body,
				)}
		</>
	);
});
