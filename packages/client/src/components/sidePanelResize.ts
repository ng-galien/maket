const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 760;

export type ResizablePanel = "library";

const PANEL_WIDTH_KEYS: Record<ResizablePanel, string> = {
	library: "maket-library-width",
};

export function clampPanelWidth(
	width: number,
	viewportWidth = window.innerWidth,
): number {
	const availableWidth = Math.max(0, viewportWidth - 16);
	return Math.min(
		MAX_PANEL_WIDTH,
		availableWidth,
		Math.max(MIN_PANEL_WIDTH, width),
	);
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
