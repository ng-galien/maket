import { select } from "d3-selection";
import "d3-transition";
import {
	zoom as d3Zoom,
	type ZoomBehavior,
	zoomIdentity,
	zoomTransform,
} from "d3-zoom";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import {
	cancelDeferredFitOnUserZoom,
	createDeferredFit,
} from "../store/deferredFit";
import {
	previewCursorForPage,
	useStore,
	useWorkspaceDocNames,
} from "../store/useStore";
import {
	consumePendingFit,
	consumeWorkspaceRemovalFitSuppression,
	registerCancelFit,
	registerFitToDoc,
	registerFitToView,
	registerRequestFit,
	registerZoomTo,
	requestFit,
} from "../store/zoomBridge";
import { boardDocFrame } from "./boardGeometry";
import { WorkspaceDoc } from "./WorkspaceDoc";

const DOC_GAP = 80;

function Watermark() {
	const t = useT();
	return (
		<div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none z-0">
			<div
				style={{
					fontFamily: "var(--font-display)",
					fontSize: "var(--text-display)",
					fontWeight: 800,
					letterSpacing: 30,
					textTransform: "uppercase",
					color: "light-dark(rgba(0, 0, 0, 0.035), rgba(255, 255, 255, 0.03))",
				}}
			>
				{t("watermark_title")}
			</div>
			<div
				className="flex flex-col items-center gap-4 -mt-4"
				style={{
					color: "light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.08))",
				}}
			>
				<div style={{ fontSize: "var(--text-xl)", fontWeight: 400 }}>
					{t("watermark_pan")} · {t("watermark_zoom")}
				</div>
			</div>
		</div>
	);
}

export function Board({ locked }: { locked: boolean }) {
	const workspaceDocNames = useWorkspaceDocNames();
	const wrapRef = useRef<HTMLDivElement>(null);
	const boardRef = useRef<HTMLDivElement>(null);
	const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
	const [boardVisible, setBoardVisible] = useState(
		workspaceDocNames.length === 0,
	);
	const spaceRef = useSpacePanCursor(wrapRef);

	useBoardZoom({
		locked,
		spaceRef,
		wrapRef,
		boardRef,
		setBoardVisible,
		setTransform,
	});
	useAutoFocusFit(workspaceDocNames);

	const handleBgClick = useCallback((e: React.MouseEvent) => {
		if (e.target === wrapRef.current || e.target === boardRef.current) {
			useStore.getState().selectElement(null);
			for (const el of document.querySelectorAll(".selected")) {
				el.classList.remove("selected");
			}
		}
	}, []);

	return (
		<div
			ref={wrapRef}
			className="absolute inset-0 overflow-hidden"
			onClick={handleBgClick}
		>
			<Watermark />
			<div
				ref={boardRef}
				style={{
					transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.k})`,
					transformOrigin: "0 0",
					position: "absolute",
					willChange: "transform",
					visibility: boardVisible ? "visible" : "hidden",
					display: "flex",
					alignItems: "flex-start",
					gap: DOC_GAP,
					padding: 40,
				}}
			>
				{workspaceDocNames.map((name) => (
					<WorkspaceDoc key={name} docName={name} zoomK={transform.k} />
				))}
			</div>
		</div>
	);
}

function useAutoFocusFit(workspaceDocNames: string[]): void {
	const focusedDocName = useStore((state) => state.focusedDocName);
	const focusedPageIndex = useStore((state) => state.focusedPageIndex);
	const autoFocusFit = useStore((state) => state.autoFocusFit);
	const collectionGeometryKey = useStore(collectionRenderGeometryKey);
	const workspaceCount = workspaceDocNames.length;
	const previousWorkspaceCount = useRef(workspaceCount);
	const previousCollectionLayout = useRef({
		docName: focusedDocName,
		pageIndex: focusedPageIndex,
		geometryKey: collectionGeometryKey,
	});
	const workspaceKey = workspaceDocNames.join("\u0000");
	useEffect(() => {
		const removalSuppressedAutoFit = consumeWorkspaceRemovalFitSuppression();
		const workspaceShrank = workspaceCount < previousWorkspaceCount.current;
		previousWorkspaceCount.current = workspaceCount;
		if (removalSuppressedAutoFit || workspaceShrank) return;
		if (!autoFocusFit || !focusedDocName) return;
		requestFit({ docName: focusedDocName, pageIndex: focusedPageIndex });
	}, [
		autoFocusFit,
		focusedDocName,
		focusedPageIndex,
		workspaceCount,
		workspaceKey,
	]);
	useEffect(() => {
		const previous = previousCollectionLayout.current;
		previousCollectionLayout.current = {
			docName: focusedDocName,
			pageIndex: focusedPageIndex,
			geometryKey: collectionGeometryKey,
		};
		const samePage =
			previous.docName === focusedDocName &&
			previous.pageIndex === focusedPageIndex;
		if (
			!autoFocusFit ||
			!focusedDocName ||
			!samePage ||
			previous.geometryKey === collectionGeometryKey
		) {
			return;
		}
		requestFit({ docName: focusedDocName });
	}, [autoFocusFit, collectionGeometryKey, focusedDocName, focusedPageIndex]);
}

function collectionRenderGeometryKey(
	state: ReturnType<typeof useStore.getState>,
): string | null {
	if (!state.focusedDocName) return null;
	const cursor = previewCursorForPage(
		state,
		state.focusedDocName,
		state.focusedPageIndex,
	);
	if (!cursor) return null;
	const collection =
		state.collectionDrafts[cursor.collection] ??
		state.collections.find((item) => item.name === cursor.collection);
	const renderCount =
		cursor.mode === "all" ? (collection?.members.length ?? 0) : 1;
	return `${cursor.collection}\u0000${cursor.mode}\u0000${renderCount}`;
}

function useSpacePanCursor(wrapRef: React.RefObject<HTMLDivElement | null>) {
	const spaceRef = useRef(false);
	useEffect(() => {
		const down = (e: KeyboardEvent) => {
			if (!isSpacePanStart(e)) return;
			e.preventDefault();
			spaceRef.current = true;
			if (wrapRef.current) wrapRef.current.style.cursor = "grab";
		};
		const up = (e: KeyboardEvent) => {
			if (e.code !== "Space") return;
			spaceRef.current = false;
			if (wrapRef.current) wrapRef.current.style.cursor = "";
		};
		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		return () => {
			window.removeEventListener("keydown", down);
			window.removeEventListener("keyup", up);
		};
	}, [wrapRef]);
	return spaceRef;
}

function isSpacePanStart(e: KeyboardEvent): boolean {
	if (e.code !== "Space" || e.repeat) return false;
	return !(e.target as HTMLElement).matches("input,textarea,[contenteditable]");
}

interface BoardZoomInputs {
	locked: boolean;
	spaceRef: React.RefObject<boolean>;
	wrapRef: React.RefObject<HTMLDivElement | null>;
	boardRef: React.RefObject<HTMLDivElement | null>;
	setBoardVisible: (visible: boolean) => void;
	setTransform: (transform: { x: number; y: number; k: number }) => void;
}

function useBoardZoom({
	locked,
	spaceRef,
	wrapRef,
	boardRef,
	setBoardVisible,
	setTransform,
}: BoardZoomInputs): void {
	const lockedRef = useRef(locked);
	useEffect(() => {
		lockedRef.current = locked;
	}, [locked]);
	useEffect(
		runBoardZoomEffect.bind(null, {
			boardRef,
			lockedRef,
			setBoardVisible,
			setTransform,
			spaceRef,
			wrapRef,
		}),
		[boardRef, lockedRef, setBoardVisible, setTransform, spaceRef, wrapRef],
	);
}

interface BoardZoomEffectContext {
	lockedRef: React.RefObject<boolean>;
	spaceRef: React.RefObject<boolean>;
	wrapRef: React.RefObject<HTMLDivElement | null>;
	boardRef: React.RefObject<HTMLDivElement | null>;
	setBoardVisible: (visible: boolean) => void;
	setTransform: (transform: { x: number; y: number; k: number }) => void;
}

function runBoardZoomEffect(context: BoardZoomEffectContext) {
	if (!context.wrapRef.current) return;
	const wrap = context.wrapRef.current;
	const el = select(wrap as Element);
	const zoomBehavior = createBoardZoomBehavior(
		context.lockedRef,
		context.spaceRef,
		context.setTransform,
	);
	el.call(zoomBehavior);
	registerBoardZoomCommands(el, zoomBehavior, wrap, context.boardRef);
	const fit = createFitToView(el, zoomBehavior, wrap, context.boardRef);
	registerFitToView(fit);
	const fitDoc = createFitToDoc(el, zoomBehavior, wrap, context.boardRef);
	registerFitToDoc(fitDoc);
	const deferredFit = createDeferredFit(fit, fitDoc);
	registerCancelFit(() => {
		deferredFit.cancel();
		el.interrupt();
	});
	zoomBehavior.on("start.deferred-fit", (event) => {
		cancelDeferredFitOnUserZoom(deferredFit, event);
	});
	registerRequestFit(deferredFit.request);
	const boardRo = observeInitialBoardFit(
		context.boardRef,
		deferredFit.request,
		context.setBoardVisible,
	);
	const wrapResize = observeWrapResize(wrap, el, zoomBehavior);
	return () => {
		deferredFit.dispose();
		zoomBehavior.on("start.deferred-fit", null);
		cleanupBoardZoom(el, boardRo, wrapResize);
	};
}

function createBoardZoomBehavior(
	lockedRef: React.RefObject<boolean>,
	spaceRef: React.RefObject<boolean>,
	setTransform: (transform: { x: number; y: number; k: number }) => void,
): ZoomBehavior<Element, unknown> {
	return d3Zoom<Element, unknown>()
		.scaleExtent([0.05, 3])
		.filter(canStartBoardZoomFromRefs.bind(null, lockedRef, spaceRef))
		.on("zoom", applyBoardZoomTransform.bind(null, setTransform));
}

function canStartBoardZoomFromRefs(
	lockedRef: React.RefObject<boolean>,
	spaceRef: React.RefObject<boolean>,
	event: { type: string; target: EventTarget | null },
): boolean {
	return canStartBoardZoom(event, lockedRef.current, spaceRef.current);
}

function applyBoardZoomTransform(
	setTransform: (transform: { x: number; y: number; k: number }) => void,
	event: { transform: { x: number; y: number; k: number } },
) {
	const transform = event.transform;
	setTransform({ x: transform.x, y: transform.y, k: transform.k });
	const zoom = Math.round(transform.k * 100);
	const store = useStore.getState();
	if (store.zoom !== zoom) store.setZoom(zoom);
}

function canStartBoardZoom(
	e: { type: string; target: EventTarget | null },
	locked: boolean,
	spacePressed: boolean,
): boolean {
	if (e.type === "wheel") return true;
	if (locked) return true;
	if (e.type !== "mousedown") return false;
	const mouse = e as MouseEvent;
	if (mouse.button === 1) return true;
	if (mouse.button !== 0) return false;
	if (spacePressed) return true;
	return !(e.target as HTMLElement).closest("[data-id]");
}

function registerBoardZoomCommands(
	el: ReturnType<typeof select<Element, unknown>>,
	zoomBehavior: ZoomBehavior<Element, unknown>,
	wrap: HTMLDivElement,
	boardRef: React.RefObject<HTMLDivElement | null>,
): void {
	registerZoomTo((pct) => {
		const rect = wrap.getBoundingClientRect();
		el.call(zoomBehavior.scaleTo, pct / 100, [rect.width / 2, rect.height / 2]);
	});
	registerFitToView(createFitToView(el, zoomBehavior, wrap, boardRef));
}

function createFitToView(
	el: ReturnType<typeof select<Element, unknown>>,
	zoomBehavior: ZoomBehavior<Element, unknown>,
	wrap: HTMLDivElement,
	boardRef: React.RefObject<HTMLDivElement | null>,
) {
	return () => {
		if (!boardRef.current) return;
		const wrapRect = wrap.getBoundingClientRect();
		const boardRect = boardRef.current.getBoundingClientRect();
		const k = zoomTransform(wrap as unknown as Element).k || 1;
		const cw = boardRect.width / k || 400;
		const ch = boardRect.height / k || 400;
		const scale = Math.min(
			(wrapRect.width * 0.85) / cw,
			(wrapRect.height * 0.85) / ch,
			2,
		);
		const tx = (wrapRect.width - cw * scale) / 2;
		const ty = Math.max(20, (wrapRect.height - ch * scale) / 2);
		el.call(
			zoomBehavior.transform,
			zoomIdentity.translate(tx, ty).scale(scale),
		);
	};
}

function createFitToDoc(
	el: ReturnType<typeof select<Element, unknown>>,
	zoomBehavior: ZoomBehavior<Element, unknown>,
	wrap: HTMLDivElement,
	boardRef: React.RefObject<HTMLDivElement | null>,
) {
	return (docName: string, pageIndex?: number) => {
		const board = boardRef.current;
		if (!board) return;
		const docEl = findBoardDocElement(board, docName, pageIndex);
		if (!docEl) return;
		const frame = boardDocFrame(docEl);
		const scale = Math.min(
			(wrap.clientWidth * 0.85) / frame.width,
			(wrap.clientHeight * 0.85) / frame.height,
			2,
		);
		const tx = wrap.clientWidth / 2 - (frame.left + frame.width / 2) * scale;
		const ty = wrap.clientHeight / 2 - (frame.top + frame.height / 2) * scale;
		el.transition()
			.duration(300)
			.call(
				zoomBehavior.transform,
				zoomIdentity.translate(tx, ty).scale(scale),
			);
	};
}

function findBoardDocElement(
	board: HTMLDivElement | null,
	docName: string,
	pageIndex?: number,
): HTMLElement | null {
	if (!board) return null;
	const docSelector = `[data-doc="${CSS.escape(docName)}"]`;
	const pageSel =
		pageIndex != null ? `${docSelector} [data-page="${pageIndex}"]` : null;
	const target = pageSel ? board.querySelector<HTMLElement>(pageSel) : null;
	return target ?? board.querySelector<HTMLElement>(docSelector);
}

function observeInitialBoardFit(
	boardRef: React.RefObject<HTMLDivElement | null>,
	deferredRequestFit: (target?: {
		docName: string;
		pageIndex?: number;
	}) => void,
	setBoardVisible: (visible: boolean) => void,
): ResizeObserver {
	let initialFitDone = false;
	const boardRo = new ResizeObserver(() => {
		if (initialFitDone || !boardRef.current?.querySelector("[data-doc]"))
			return;
		initialFitDone = true;
		const pending = consumePendingFit();
		if (pending) deferredRequestFit(pending.target);
		else deferredRequestFit();
		setBoardVisible(true);
	});
	if (boardRef.current) boardRo.observe(boardRef.current);
	return boardRo;
}

function observeWrapResize(
	wrap: HTMLDivElement,
	el: ReturnType<typeof select<Element, unknown>>,
	zoomBehavior: ZoomBehavior<Element, unknown>,
): { observer: ResizeObserver; onOrientation: () => void } {
	let lastW = 0;
	let lastH = 0;
	const recenter = (w: number, h: number) => {
		const dx = lastW === 0 ? 0 : (w - lastW) / 2;
		const dy = lastH === 0 ? 0 : (h - lastH) / 2;
		lastW = w;
		lastH = h;
		if (dx === 0 && dy === 0) return;
		const current = zoomTransform(wrap as unknown as Element);
		el.call(
			zoomBehavior.transform,
			zoomIdentity.translate(current.x + dx, current.y + dy).scale(current.k),
		);
	};
	const observer = new ResizeObserver((entries) => {
		const entry = entries[0];
		if (entry) recenter(entry.contentRect.width, entry.contentRect.height);
	});
	const onOrientation = () =>
		requestAnimationFrame(() => {
			const rect = wrap.getBoundingClientRect();
			recenter(rect.width, rect.height);
		});
	observer.observe(wrap);
	window.addEventListener("orientationchange", onOrientation);
	return { observer, onOrientation };
}

function cleanupBoardZoom(
	el: ReturnType<typeof select<Element, unknown>>,
	boardRo: ResizeObserver,
	wrapResize: { observer: ResizeObserver; onOrientation: () => void },
): void {
	el.on(".zoom", null);
	boardRo.disconnect();
	wrapResize.observer.disconnect();
	window.removeEventListener("orientationchange", wrapResize.onOrientation);
	registerFitToView(() => {});
	registerFitToDoc(() => {});
	registerRequestFit(null);
	registerCancelFit(null);
	registerZoomTo(() => {});
}
