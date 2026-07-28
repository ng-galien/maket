/** Bridge between the zoom slider (BottomBar) and d3-zoom (Workspace). */
let _zoomTo: ((pct: number) => void) | null = null;
let _fitToView: (() => void) | null = null;
let _fitToDoc: ((docName: string, pageIndex?: number) => void) | null = null;

export interface FitTarget {
	docName: string;
	pageIndex?: number;
}

let _requestFit: ((target?: FitTarget) => void) | null = null;

export function registerRequestFit(
	fn: ((target?: FitTarget) => void) | null,
): void {
	_requestFit = fn;
}

export function registerZoomTo(fn: (pct: number) => void): void {
	_zoomTo = fn;
}

export function registerFitToView(fn: () => void): void {
	_fitToView = fn;
}

export function registerFitToDoc(
	fn: (docName: string, pageIndex?: number) => void,
): void {
	_fitToDoc = fn;
}

export function zoomTo(pct: number): void {
	_zoomTo?.(pct);
}

export function fitToView(): void {
	_fitToView?.();
}

export function fitToDoc(docName: string, pageIndex?: number): void {
	_fitToDoc?.(docName, pageIndex);
}

/**
 * Fit once the board content has actually laid out — Board owns the timing
 * (double rAF after commit plus a 300ms settle, see createDeferredFit; a new
 * request replaces any pending one), so callers never schedule their own
 * timers. Falls back to an immediate fit when no Board is mounted.
 */
export function requestFit(target?: FitTarget): void {
	if (_requestFit) {
		_requestFit(target);
	} else if (target) {
		fitToDoc(target.docName, target.pageIndex);
	} else {
		fitToView();
	}
}
