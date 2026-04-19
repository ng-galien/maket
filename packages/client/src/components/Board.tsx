import { select } from "d3-selection";
import {
	zoom as d3Zoom,
	type ZoomBehavior,
	zoomIdentity,
	zoomTransform,
} from "d3-zoom";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { useStore, useWorkspaceDocNames } from "../store/useStore";
import { registerFitToView, registerZoomTo } from "../store/zoomBridge";
import { WorkspaceDoc } from "./WorkspaceDoc";

const DOC_GAP = 80; // px gap between docs

function Watermark() {
	const t = useT();
	return (
		<div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none z-0">
			<div
				style={{
					fontFamily: "'Raleway', sans-serif",
					fontSize: 200,
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
				<div
					style={{
						fontFamily: "monospace",
						fontSize: 28,
						fontWeight: 600,
						letterSpacing: 3,
					}}
				>
					{t("watermark_command")}
				</div>
				<div style={{ fontSize: 20, fontWeight: 400 }}>
					{t("watermark_pan")} · {t("watermark_zoom")}
				</div>
			</div>
		</div>
	);
}

export function Board({ locked }: { locked: boolean }) {
	const workspaceDocNames = useWorkspaceDocNames();
	const setZoom = useStore((s) => s.setZoom);
	const wrapRef = useRef<HTMLDivElement>(null);
	const boardRef = useRef<HTMLDivElement>(null);
	const zoomRef = useRef<ZoomBehavior<Element, unknown> | null>(null);
	const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
	const [boardVisible, setBoardVisible] = useState(
		workspaceDocNames.length === 0,
	);

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

	// d3-zoom for pan & scroll over the entire board
	useEffect(() => {
		if (!wrapRef.current) return;
		const el = select(wrapRef.current as Element);

		const zoomBehavior = d3Zoom<Element, unknown>()
			.scaleExtent([0.05, 3])
			.filter((e) => {
				if (e.type === "wheel") return true;
				if (locked) return true;
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
				setZoom(Math.round(e.transform.k * 100));
			});

		zoomRef.current = zoomBehavior;
		el.call(zoomBehavior as any);

		registerZoomTo((pct) => {
			const vw = window.innerWidth / 2;
			const vh = window.innerHeight / 2;
			(el as any).call(zoomBehavior.scaleTo, pct / 100, [vw, vh]);
		});

		const fit = () => {
			if (!boardRef.current || !wrapRef.current) return;
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const boardRect = boardRef.current.getBoundingClientRect();
			const k = zoomTransform(wrapRef.current as unknown as Element).k || 1;
			const cw = boardRect.width / k || 400;
			const ch = boardRect.height / k || 400;
			const scale = Math.min((vw * 0.6) / cw, (vh * 0.65) / ch, 2);
			const tx = (vw - cw * scale) / 2;
			const ty = Math.max(20, (vh - ch * scale) / 2);
			el.call(
				(zoomBehavior as any).transform,
				zoomIdentity.translate(tx, ty).scale(scale),
			);
		};

		registerFitToView(fit);

		// Fit once when docs are actually rendered (WS data received), then show
		let initialFitDone = false;
		const ro = new ResizeObserver(() => {
			if (!initialFitDone && boardRef.current?.querySelector("[data-doc]")) {
				initialFitDone = true;
				fit();
				setBoardVisible(true);
			}
		});
		if (boardRef.current) ro.observe(boardRef.current);

		const onResize = () => fit();
		window.addEventListener("resize", onResize);

		return () => {
			el.on(".zoom", null);
			window.removeEventListener("resize", onResize);
			ro.disconnect();
			registerFitToView(() => {});
			registerZoomTo(() => {});
		};
	}, [locked, workspaceDocNames.length]);

	// Background click → deselect
	const handleBgClick = useCallback((e: React.MouseEvent) => {
		if (e.target === wrapRef.current || e.target === boardRef.current) {
			useStore.getState().selectElement(null);
			document.querySelectorAll(".selected").forEach((el) => {
				el.classList.remove("selected");
			});
		}
	}, []);

	if (workspaceDocNames.length === 0) {
		return (
			<div className="absolute inset-0 flex items-center justify-center text-text-3 text-sm">
				<Watermark />
			</div>
		);
	}

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
