/** Bridge between the zoom slider (BottomBar) and d3-zoom (Workspace). */
let _zoomTo: ((pct: number) => void) | null = null;
let _fitToView: (() => void) | null = null;
let _fitToDoc: ((docName: string, pageIndex?: number) => void) | null = null;

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
