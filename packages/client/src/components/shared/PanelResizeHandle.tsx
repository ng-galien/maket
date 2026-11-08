import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/useT";
import {
	clampPanelWidth,
	type ResizablePanel,
	savePanelWidth,
} from "../sidePanelResize";
import { ResizeHandleFeedback } from "./ResizeHandleFeedback";

export function PanelResizeHandle({
	panel,
	width,
	setWidth,
	panelRef,
	edge = "right",
}: {
	panel: ResizablePanel;
	edge?: "left" | "right";
	width: number;
	setWidth: (width: number) => void;
	panelRef: React.RefObject<HTMLElement | null>;
}) {
	const cancelResizeRef = useRef<(() => void) | null>(null);
	const [resizing, setResizing] = useState(false);
	const t = useT();
	useEffect(() => () => cancelResizeRef.current?.(), []);

	const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		if (event.button !== 0) return;
		cancelResizeRef.current?.();
		const direction = edge === "left" ? -1 : 1;
		const startX = event.clientX;
		const startWidth = panelRef.current?.getBoundingClientRect().width ?? width;
		setResizing(true);
		panelRef.current?.setAttribute("data-resizing", "true");
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		const move = (moveEvent: PointerEvent) =>
			setWidth(
				clampPanelWidth(
					startWidth + direction * (moveEvent.clientX - startX),
					window.innerWidth,
					panel,
				),
			);
		const stop = () => {
			savePanelWidth(
				panel,
				panelRef.current?.getBoundingClientRect().width ?? width,
			);
			setResizing(false);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			panelRef.current?.removeAttribute("data-resizing");
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
			window.removeEventListener("blur", stop);
			cancelResizeRef.current = null;
		};
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
			aria-label={t(
				panel === "library" ? "resize_library_panel" : "hand_resize_panel",
			)}
			aria-valuemin={panel === "composer" ? 240 : 320}
			aria-valuemax={Math.min(760, window.innerWidth - 16)}
			aria-valuenow={Math.round(width)}
			data-resizing={resizing || undefined}
			onPointerDown={startResize}
			onKeyDown={(event) => {
				if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
				event.preventDefault();
				const delta = event.key === "ArrowRight" ? 16 : -16;
				const next = clampPanelWidth(
					width + delta * (edge === "left" ? -1 : 1),
					window.innerWidth,
					panel,
				);
				setWidth(next);
				savePanelWidth(panel, next);
			}}
			className={`group/resize absolute inset-y-3 ${edge === "left" ? "-left-1.5" : "-right-1.5"} z-10 flex w-3 touch-none cursor-col-resize items-center justify-center focus-visible:outline-none`}
		>
			<ResizeHandleFeedback orientation="vertical" active={resizing} />
		</div>
	);
}
