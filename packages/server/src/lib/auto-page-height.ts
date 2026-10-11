import { fitBoundTextareaHeight } from "@maket/shared";
import type { RenderPage } from "../services/browser-pool.js";

/** Measure only AUTO frames after fonts and images have settled; never persist derived heights. */
export function measureAutoPageHeights(
	page: RenderPage,
	print = false,
): Promise<number[]> {
	return page.evaluate(
		`(() => { globalThis.__name ??= (target) => target; return (${sizeAutoPagesInBrowser.toString()})(${print}, ${fitBoundTextareaHeight.toString()}); })()`,
	);
}

/** Self-contained browser code, shared by headless export and the CSP-safe print route. */
function sizeAutoPagesInBrowser(
	print: boolean,
	fitTextarea: (textarea: HTMLTextAreaElement) => void,
): number[] {
	const frames = [
		...document.querySelectorAll<HTMLElement>(
			'maket-render-page[data-maket-auto-height="true"]',
		),
	];
	for (const frame of frames) {
		frame
			.querySelectorAll<HTMLTextAreaElement>(
				"textarea[data-maket-bind][data-maket-path]",
			)
			.forEach(fitTextarea);
	}
	const heights = frames.map((frame) => {
		const scale = frame.getBoundingClientRect().width / frame.offsetWidth || 1;
		return Math.max(
			1,
			Math.ceil(
				Math.max(
					frame.getBoundingClientRect().height,
					frame.scrollHeight * scale,
				),
			),
		);
	});
	if (print) {
		let stylesheet = document.getElementById("maket-auto-page-sizes");
		if (!stylesheet) {
			stylesheet = document.createElement("style");
			stylesheet.id = "maket-auto-page-sizes";
			document.head.append(stylesheet);
		}
		stylesheet.textContent = frames
			.map((frame, index) => {
				const name = `maketAuto${index + 1}`;
				frame.style.page = name;
				return `@page ${name} { size: ${frame.offsetWidth}px ${heights[index]}px; margin: 0; }`;
			})
			.join("\n");
	}
	return heights;
}

const AUTO_PAGE_BEFORE_PRINT_SCRIPT = `window.addEventListener("beforeprint", () => { (${sizeAutoPagesInBrowser.toString()})(true, ${fitBoundTextareaHeight.toString()}); });`;

export const AUTO_PAGE_SIZE_SCRIPT = `globalThis.__name ??= (target) => target;
${AUTO_PAGE_BEFORE_PRINT_SCRIPT}
window.maketAutoPagesReady = new Promise(resolve => window.addEventListener('load', async () => {
 await Promise.all([document.fonts.ready, ...[...document.images].map(image => image.decode().catch(() => undefined))]);
 requestAnimationFrame(() => { (${sizeAutoPagesInBrowser.toString()})(true, ${fitBoundTextareaHeight.toString()}); resolve(); });
}));`;
