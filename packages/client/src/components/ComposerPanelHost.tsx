import { useCallback, useEffect, useRef, useState } from "react";
import { PanelResizeHandle } from "./shared/PanelResizeHandle";
import { clampPanelWidth, loadPanelWidth } from "./sidePanelResize";

/** The Composer shares the library's gutter and keeps its preferred width. */
export function ComposerPanelHost() {
	const [width, setWidth] = useState(() => loadPanelWidth("composer"));
	const preferredWidth = useRef(width);
	const panelRef = useRef<HTMLElement>(null);
	const resizePanel = useCallback((next: number) => {
		preferredWidth.current = next;
		setWidth(next);
	}, []);
	useEffect(() => {
		const reclamp = () =>
			setWidth(
				clampPanelWidth(preferredWidth.current, window.innerWidth, "composer"),
			);
		window.addEventListener("resize", reclamp);
		return () => window.removeEventListener("resize", reclamp);
	}, []);
	return (
		<aside
			ref={panelRef}
			data-composer-panel
			className="relative min-h-0 shrink-0 border-l border-border bg-panel"
			style={{ width }}
		>
			<div id="hand-composer-host" className="h-full overflow-y-auto" />
			<PanelResizeHandle
				panel="composer"
				edge="left"
				width={width}
				setWidth={resizePanel}
				panelRef={panelRef}
			/>
		</aside>
	);
}
