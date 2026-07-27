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
import { useStore, useWorkspaceDocNames } from "../store/useStore";
import {
	registerFitToDoc,
	registerFitToView,
	registerZoomTo,
} from "../store/zoomBridge";
import { CollectionWorkspace } from "./CollectionWorkspace";
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
	const focusedCollectionName = useStore((s) => s.focusedCollectionName);
	const readOnly = useStore((s) => s.readOnly);
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
				{focusedCollectionName && !readOnly && (
					<CollectionWorkspace
						key={focusedCollectionName}
						zoomK={transform.k}
					/>
				)}
			</div>
		</div>
	);
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
	registerFitToDoc(createFitToDoc(el, zoomBehavior, wrap, context.boardRef));
	const boardRo = observeInitialBoardFit(
		context.boardRef,
		fit,
		context.setBoardVisible,
	);
	const wrapResize = observeWrapResize(wrap, el, zoomBehavior);
	return () => cleanupBoardZoom(el, boardRo, wrapResize);
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
	useStore.getState().setZoom(Math.round(transform.k * 100));
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
		const docEl = findBoardDocElement(boardRef.current, docName, pageIndex);
		if (!docEl) return;
		const frame = boardDocFrame(wrap, docEl);
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

function boardDocFrame(wrap: HTMLDivElement, docEl: HTMLElement) {
	const wrapRect = wrap.getBoundingClientRect();
	const docRect = docEl.getBoundingClientRect();
	const t = zoomTransform(wrap as unknown as Element);
	const k = t.k || 1;
	return {
		left: (docRect.left - wrapRect.left - t.x) / k,
		top: (docRect.top - wrapRect.top - t.y) / k,
		width: docRect.width / k,
		height: docRect.height / k,
	};
}

function observeInitialBoardFit(
	boardRef: React.RefObject<HTMLDivElement | null>,
	fit: () => void,
	setBoardVisible: (visible: boolean) => void,
): ResizeObserver {
	let initialFitDone = false;
	const boardRo = new ResizeObserver(() => {
		if (initialFitDone || !boardRef.current?.querySelector("[data-doc]"))
			return;
		initialFitDone = true;
		fit();
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
	registerZoomTo(() => {});
}
