import type { FitTarget } from "./zoomBridge";

export interface DeferredFit {
	request(target?: FitTarget): void;
	cancel(): void;
	dispose(): void;
}

/**
 * Fit after layout commit and once more after fonts/images have settled.
 * Callers must cancel on direct user zoom/pan so the settle pass never
 * overrides an interaction that began after hydration.
 */
export function createDeferredFit(
	fitView: () => void,
	fitDoc: (docName: string, pageIndex?: number) => void,
): DeferredFit {
	let raf1 = 0;
	let raf2 = 0;
	let settle: ReturnType<typeof setTimeout> | null = null;
	const cancel = () => {
		cancelAnimationFrame(raf1);
		cancelAnimationFrame(raf2);
		if (settle) clearTimeout(settle);
		settle = null;
	};
	return {
		request: (target) => {
			const fit = target
				? () => fitDoc(target.docName, target.pageIndex)
				: fitView;
			cancel();
			raf1 = requestAnimationFrame(() => {
				raf2 = requestAnimationFrame(fit);
			});
			settle = setTimeout(fit, 300);
		},
		cancel,
		dispose: cancel,
	};
}

export function cancelDeferredFitOnUserZoom(
	deferredFit: Pick<DeferredFit, "cancel">,
	event: { sourceEvent?: Event | null },
): void {
	if (event.sourceEvent) deferredFit.cancel();
}
