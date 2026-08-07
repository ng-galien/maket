import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import { clampPanelWidth, initialPanelWidth } from "./sidePanelResize";

interface Props {
	open: boolean;
	onClose: () => void;
	side?: "left" | "right";
	resizable?: boolean;
	children: React.ReactNode;
}

export function SidePanel({
	open,
	onClose,
	side = "left",
	resizable = false,
	children,
}: Props) {
	const barPosition = useStore((s) => s.barPosition);
	const [width, setWidth] = useState(initialPanelWidth);
	const panelRef = useRef<HTMLElement>(null);

	const barSide = 68;
	const freeSide = 8;
	const positionStyle =
		barPosition === "top"
			? { top: barSide, maxHeight: `calc(100vh - ${barSide + freeSide}px)` }
			: { bottom: barSide, maxHeight: `calc(100vh - ${barSide + freeSide}px)` };
	const panelStyle = {
		...positionStyle,
		...(resizable ? { width } : {}),
		maxWidth: "calc(100vw - 16px)",
	};

	const sideClass =
		side === "left"
			? `left-0 rounded-r-xl ${open ? "translate-x-0" : "-translate-x-full"}`
			: `right-0 rounded-l-xl ${open ? "translate-x-0" : "translate-x-full"}`;

	return (
		<>
			{open && (
				<div
					role="button"
					tabIndex={-1}
					onKeyDown={(e) => {
						if (e.key === "Escape") onClose();
					}}
					className="fixed inset-0 bg-black/8 z-[200]"
					onClick={onClose}
				/>
			)}

			<aside
				ref={panelRef}
				style={panelStyle}
				className={`fixed w-[90vw] sm:w-[50vw] md:w-[33vw] bg-panel border border-border shadow-[0_20px_60px_rgba(0,0,0,0.15)] z-[201] flex flex-col overflow-hidden transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] rounded-xl ${sideClass}`}
			>
				{resizable && (
					<PanelResizeHandle
						side={side}
						width={width}
						setWidth={setWidth}
						panelRef={panelRef}
					/>
				)}
				<div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-border">
					{children}
				</div>
			</aside>
		</>
	);
}

function PanelResizeHandle({
	side,
	width,
	setWidth,
	panelRef,
}: {
	side: "left" | "right";
	width: number;
	setWidth: (width: number) => void;
	panelRef: React.RefObject<HTMLElement | null>;
}) {
	const cancelResizeRef = useRef<(() => void) | null>(null);
	useEffect(() => () => cancelResizeRef.current?.(), []);

	const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = panelRef.current?.getBoundingClientRect().width ?? width;
		const direction = side === "left" ? 1 : -1;
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";

		const move = (moveEvent: PointerEvent) => {
			setWidth(
				clampPanelWidth(startWidth + (moveEvent.clientX - startX) * direction),
			);
		};
		const stop = () => {
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
			window.removeEventListener("blur", stop);
			cancelResizeRef.current = null;
		};
		cancelResizeRef.current?.();
		cancelResizeRef.current = stop;
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", stop);
		window.addEventListener("pointercancel", stop);
		window.addEventListener("blur", stop);
	};

	return (
		<div
			role="separator"
			tabIndex={0}
			aria-orientation="vertical"
			aria-label="Resize panel"
			aria-valuemin={320}
			aria-valuemax={Math.min(760, window.innerWidth - 16)}
			aria-valuenow={Math.round(width)}
			onPointerDown={startResize}
			onKeyDown={(event) => {
				if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
				event.preventDefault();
				const arrowDirection = event.key === "ArrowRight" ? 1 : -1;
				const sideDirection = side === "left" ? 1 : -1;
				const renderedWidth =
					panelRef.current?.getBoundingClientRect().width ?? width;
				setWidth(
					clampPanelWidth(renderedWidth + arrowDirection * sideDirection * 16),
				);
			}}
			className={`absolute inset-y-3 z-10 hidden w-2 cursor-col-resize sm:flex items-center justify-center group/resize ${
				side === "left" ? "right-0" : "left-0"
			}`}
		>
			<span className="h-10 w-px rounded-full bg-border transition-all group-hover/resize:h-14 group-hover/resize:bg-text-3" />
		</div>
	);
}
