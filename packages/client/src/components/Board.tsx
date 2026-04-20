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
import { WorkspaceDoc } from "./WorkspaceDoc";

const DOC_GAP = 80; // px gap between docs

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
	const zoomRef = useRef<ZoomBehavior<Element, unknown> | null>(null);
	const lockedRef = useRef(locked);
	const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
	const [boardVisible, setBoardVisible] = useState(
		workspaceDocNames.length === 0,
	);

	// Mirror `locked` into a ref so the d3-zoom filter (created once) reads the
	// live value without re-instantiating the behavior on every toggle.
	useEffect(() => {
		lockedRef.current = locked;
	}, [locked]);

	// Space key = pan mode (like Figma)
	const spaceRef = useRef(false);
	useEffect(() => {
		const down = (e: KeyboardEvent) => {
			if (
				e.code === "Space" &&
				!e.repeat &&
				!(e.target as HTMLElement).matches("input,textarea,[contenteditable]")
			) {
				e.preventDefault();
				spaceRef.current = true;
				if (wrapRef.current) wrapRef.current.style.cursor = "grab";
			}
		};
		const up = (e: KeyboardEvent) => {
			if (e.code === "Space") {
				spaceRef.current = false;
				if (wrapRef.current) wrapRef.current.style.cursor = "";
			}
		};
		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		return () => {
			window.removeEventListener("keydown", down);
			window.removeEventListener("keyup", up);
		};
	}, []);

	// d3-zoom: instantiated ONCE. Previously re-ran on every `locked` toggle and
	// every workspace add/remove — that wiped the user's pan/zoom. Now the filter
	// reads `lockedRef` live and adding/removing docs no longer touches the
	// transform.
	useEffect(() => {
		if (!wrapRef.current) return;
		const wrap = wrapRef.current;
		const el = select(wrap as Element);

		const zoomBehavior = d3Zoom<Element, unknown>()
			.scaleExtent([0.05, 3])
			.filter((e) => {
				if (e.type === "wheel") return true;
				if (lockedRef.current) return true;
				if (e.type === "mousedown" && (e as MouseEvent).button === 1)
					return true;
				// Space held = pan mode, ignore data-id
				if (e.type === "mousedown" && (e as MouseEvent).button === 0) {
					if (spaceRef.current) return true;
					const target = e.target as HTMLElement;
					return !target.closest("[data-id]");
				}
				return false;
			})
			.on("zoom", (e) => {
				setTransform({ x: e.transform.x, y: e.transform.y, k: e.transform.k });
				useStore.getState().setZoom(Math.round(e.transform.k * 100));
			});

		zoomRef.current = zoomBehavior;
		// biome-ignore lint/suspicious/noExplicitAny: d3-zoom typings don't flow
		el.call(zoomBehavior as any);

		registerZoomTo((pct) => {
			const rect = wrap.getBoundingClientRect();
			// biome-ignore lint/suspicious/noExplicitAny: d3-zoom typings don't flow
			(el as any).call(zoomBehavior.scaleTo, pct / 100, [
				rect.width / 2,
				rect.height / 2,
			]);
		});

		const fit = () => {
			if (!boardRef.current || !wrap) return;
			const wrapRect = wrap.getBoundingClientRect();
			const vw = wrapRect.width;
			const vh = wrapRect.height;
			const boardRect = boardRef.current.getBoundingClientRect();
			const k = zoomTransform(wrap as unknown as Element).k || 1;
			const cw = boardRect.width / k || 400;
			const ch = boardRect.height / k || 400;
			const scale = Math.min((vw * 0.85) / cw, (vh * 0.85) / ch, 2);
			const tx = (vw - cw * scale) / 2;
			const ty = Math.max(20, (vh - ch * scale) / 2);
			el.call(
				// biome-ignore lint/suspicious/noExplicitAny: d3-zoom typings don't flow
				(zoomBehavior as any).transform,
				zoomIdentity.translate(tx, ty).scale(scale),
			);
		};
		registerFitToView(fit);

		const fitToDoc = (docName: string, pageIndex?: number) => {
			if (!boardRef.current || !wrap) return;
			const docSelector = `[data-doc="${CSS.escape(docName)}"]`;
			const pageSel =
				pageIndex != null ? `${docSelector} [data-page="${pageIndex}"]` : null;
			// Prefer the targeted page's canvas — same selector as the whole-doc
			// wrapper falls back if the page isn't rendered yet (e.g. single-page docs).
			const target = pageSel
				? boardRef.current.querySelector<HTMLElement>(pageSel)
				: null;
			const docEl =
				target ?? boardRef.current.querySelector<HTMLElement>(docSelector);
			if (!docEl) return;
			const wrapRect = wrap.getBoundingClientRect();
			const docRect = docEl.getBoundingClientRect();
			const t = zoomTransform(wrap as unknown as Element);
			const k = t.k || 1;
			// Translate viewport-space doc bounds into board-space (pre-zoom).
			const boardLeft = (docRect.left - wrapRect.left - t.x) / k;
			const boardTop = (docRect.top - wrapRect.top - t.y) / k;
			const cw = docRect.width / k;
			const ch = docRect.height / k;
			const scale = Math.min(
				(wrapRect.width * 0.85) / cw,
				(wrapRect.height * 0.85) / ch,
				2,
			);
			const tx = wrapRect.width / 2 - (boardLeft + cw / 2) * scale;
			const ty = wrapRect.height / 2 - (boardTop + ch / 2) * scale;
			el.transition()
				.duration(300)
				.call(
					// biome-ignore lint/suspicious/noExplicitAny: d3-zoom typings don't flow
					(zoomBehavior as any).transform,
					zoomIdentity.translate(tx, ty).scale(scale),
				);
		};
		registerFitToDoc(fitToDoc);

		// Initial fit: when the first [data-doc] renders, the board's bounding box
		// grows and this fires. Runs once per mount.
		let initialFitDone = false;
		const boardRo = new ResizeObserver(() => {
			if (!initialFitDone && boardRef.current?.querySelector("[data-doc]")) {
				initialFitDone = true;
				fit();
				setBoardVisible(true);
			}
		});
		if (boardRef.current) boardRo.observe(boardRef.current);

		// Viewport changes (window resize, sidebar toggle, etc.): preserve scale,
		// shift pan by half the size delta so the visual center stays anchored on
		// the same board coordinate. Never calls fit() — user's pan/zoom is sacred.
		let lastW = 0;
		let lastH = 0;
		const wrapRo = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const { width: w, height: h } = entry.contentRect;
			if (lastW === 0 && lastH === 0) {
				lastW = w;
				lastH = h;
				return;
			}
			const dx = (w - lastW) / 2;
			const dy = (h - lastH) / 2;
			lastW = w;
			lastH = h;
			if (dx === 0 && dy === 0) return;
			const current = zoomTransform(wrap as unknown as Element);
			el.call(
				// biome-ignore lint/suspicious/noExplicitAny: d3-zoom typings don't flow
				(zoomBehavior as any).transform,
				zoomIdentity.translate(current.x + dx, current.y + dy).scale(current.k),
			);
		});
		wrapRo.observe(wrap);

		// iOS Safari: orientationchange can fire before the ResizeObserver reflects
		// the rotated dimensions. Take a measurement next frame as a safety net.
		const onOrientation = () => {
			requestAnimationFrame(() => {
				const rect = wrap.getBoundingClientRect();
				const dx = (rect.width - lastW) / 2;
				const dy = (rect.height - lastH) / 2;
				lastW = rect.width;
				lastH = rect.height;
				if (dx === 0 && dy === 0) return;
				const current = zoomTransform(wrap as unknown as Element);
				el.call(
					// biome-ignore lint/suspicious/noExplicitAny: d3-zoom typings don't flow
					(zoomBehavior as any).transform,
					zoomIdentity
						.translate(current.x + dx, current.y + dy)
						.scale(current.k),
				);
			});
		};
		window.addEventListener("orientationchange", onOrientation);

		return () => {
			el.on(".zoom", null);
			boardRo.disconnect();
			wrapRo.disconnect();
			window.removeEventListener("orientationchange", onOrientation);
			registerFitToView(() => {});
			registerFitToDoc(() => {});
			registerZoomTo(() => {});
		};
	}, []);

	// Background click → deselect
	const handleBgClick = useCallback((e: React.MouseEvent) => {
		if (e.target === wrapRef.current || e.target === boardRef.current) {
			useStore.getState().selectElement(null);
			for (const el of document.querySelectorAll(".selected")) {
				el.classList.remove("selected");
			}
		}
	}, []);

	// Always render wrapRef + boardRef so the zoom effect can bind on mount and
	// survive empty→populated workspace transitions without re-instantiating.
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
