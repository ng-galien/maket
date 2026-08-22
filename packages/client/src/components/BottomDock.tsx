import { useEffect, useRef, useState } from "react";

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
	useEffect(() => () => cancelResizeRef.current?.(), []);
	const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		const startY = event.clientY;
		const startHeight = height;
		let nextHeight = height;
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
			className="group/resize flex h-2 shrink-0 cursor-row-resize items-center justify-center bg-panel"
		>
			<span className="h-px w-12 rounded-full bg-border transition-all group-hover/resize:w-16 group-hover/resize:bg-text-3" />
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
