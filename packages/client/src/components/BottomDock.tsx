import {
	type CSSProperties,
	type HTMLAttributes,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { ResizeHandleFeedback } from "./shared/ResizeHandleFeedback";

interface BottomDockProps extends HTMLAttributes<HTMLElement> {
	height: CSSProperties["height"];
	resize?: {
		height: number;
		setHeight: (height: number) => void;
		storageKey: string;
		label: string;
	};
	children: ReactNode;
}

export function BottomDock({
	height,
	resize,
	children,
	className = "",
	style,
	...props
}: BottomDockProps) {
	return (
		<section
			{...props}
			style={{ ...style, height }}
			className={`relative z-[var(--z-panel)] flex w-full flex-col overflow-hidden border-t border-border bg-panel shadow-[0_-8px_24px_rgba(0,0,0,0.08)] ${className}`}
		>
			{resize && <BottomDockResizeHandle {...resize} />}
			{children}
		</section>
	);
}

export function useBottomDockHeight(
	storageKey: string,
	defaultHeight: number,
): [number, (height: number) => void] {
	const [height, setHeight] = useState(() =>
		loadBottomDockHeight(storageKey, defaultHeight),
	);
	useEffect(() => {
		setHeight(loadBottomDockHeight(storageKey, defaultHeight));
	}, [defaultHeight, storageKey]);
	return [height, setHeight];
}

export function BottomDockResizeHandle({
	height,
	setHeight,
	storageKey,
	label,
}: {
	height: number;
	setHeight: (height: number) => void;
	storageKey: string;
	label: string;
}) {
	const cancelResizeRef = useRef<(() => void) | null>(null);
	const [resizing, setResizing] = useState(false);
	useEffect(() => () => cancelResizeRef.current?.(), []);
	const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		const startY = event.clientY;
		const startHeight = height;
		let nextHeight = height;
		setResizing(true);
		document.body.style.cursor = "row-resize";
		document.body.style.userSelect = "none";
		const move = (moveEvent: PointerEvent) => {
			nextHeight = clampBottomDockHeight(
				startHeight + startY - moveEvent.clientY,
			);
			setHeight(nextHeight);
		};
		const stop = () => {
			saveBottomDockHeight(storageKey, nextHeight);
			setResizing(false);
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
			aria-orientation="horizontal"
			aria-label={label}
			aria-valuemin={180}
			aria-valuemax={Math.round(window.innerHeight * 0.78)}
			aria-valuenow={Math.round(height)}
			data-resizing={resizing || undefined}
			onPointerDown={startResize}
			onKeyDown={(event) => {
				if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
				event.preventDefault();
				const nextHeight = clampBottomDockHeight(
					height + (event.key === "ArrowUp" ? 24 : -24),
				);
				setHeight(nextHeight);
				saveBottomDockHeight(storageKey, nextHeight);
			}}
			className="group/resize relative flex h-2 shrink-0 cursor-row-resize items-center justify-center bg-panel focus-visible:outline-none"
		>
			<ResizeHandleFeedback orientation="horizontal" active={resizing} />
		</div>
	);
}

export function clampBottomDockHeight(height: number): number {
	return Math.max(180, Math.min(Math.round(window.innerHeight * 0.78), height));
}

function loadBottomDockHeight(
	storageKey: string,
	defaultHeight: number,
): number {
	const stored = Number(localStorage.getItem(storageKey));
	if (Number.isFinite(stored) && stored > 0) {
		return clampBottomDockHeight(stored);
	}
	return clampBottomDockHeight(defaultHeight);
}

function saveBottomDockHeight(storageKey: string, height: number): void {
	localStorage.setItem(storageKey, String(Math.round(height)));
}
