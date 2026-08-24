const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 760;

export type ResizablePanel = "library";

const PANEL_WIDTH_KEYS: Record<ResizablePanel, string> = {
	library: "maket-library-width",
};

/** Fit a width into the panel range. The minimum wins over the viewport so a
 * degenerate measurement never pins the panel to nothing. */
export function clampPanelWidth(
	width: number,
	viewportWidth = window.innerWidth,
): number {
	const available = Number.isFinite(viewportWidth)
		? Math.max(MIN_PANEL_WIDTH, viewportWidth - 16)
		: MAX_PANEL_WIDTH;
	const requested = Number.isFinite(width)
		? Math.max(MIN_PANEL_WIDTH, width)
		: MIN_PANEL_WIDTH;
	return Math.min(MAX_PANEL_WIDTH, available, requested);
}

export function initialPanelWidth(viewportWidth = window.innerWidth): number {
	const responsiveWidth =
		viewportWidth < 640
			? viewportWidth * 0.9
			: viewportWidth < 768
				? viewportWidth * 0.5
				: viewportWidth * 0.33;
	return clampPanelWidth(responsiveWidth, viewportWidth);
}

export function loadPanelWidth(
	panel: ResizablePanel,
	viewportWidth = window.innerWidth,
): number {
	const stored = Number(localStorage.getItem(PANEL_WIDTH_KEYS[panel]));
	return Number.isFinite(stored) && stored > 0
		? clampPanelWidth(stored, viewportWidth)
		: initialPanelWidth(viewportWidth);
}

export function savePanelWidth(panel: ResizablePanel, width: number): void {
	localStorage.setItem(PANEL_WIDTH_KEYS[panel], String(Math.round(width)));
}
