import { escapeCssValue, stripStyleClose } from "./css-escape.js";

export const RENDER_PAGE_TAG = "maket-render-page";

export type RenderSurface =
	| { kind: "snapshot" }
	| { kind: "thumbnail"; scale: number }
	| { kind: "print" };

export interface RenderSurfaceHtmlOptions {
	canvas: {
		w: number;
		h: number;
		bg?: string;
		margins?: { top: number; right: number; bottom: number; left: number };
	};
	pageHtmls: string[];
	charteCss: string;
	surface: RenderSurface;
}

/**
 * Compose authored pages inside a Maket-owned custom element.
 *
 * Headless surfaces used to create their own generic `.page` wrappers. An
 * authored `.page` selector could therefore resize, pad, or transform the
 * internal frame. The custom element and its inline geometry keep the shell
 * outside ordinary authored class/tag selectors while preserving the exact
 * same composition contract for snapshot, thumbnail, and print/PDF.
 */
export function buildRenderSurfaceHtml({
	canvas,
	pageHtmls,
	charteCss,
	surface,
}: RenderSurfaceHtmlOptions): string {
	const safeCharteCss = stripStyleClose(charteCss);
	const safeBg = escapeCssValue(canvas.bg || "#ffffff");
	const print = surface.kind === "print";
	const pageRule = print
		? `@page { size: ${canvas.w}mm ${canvas.h}mm; margin: 0; }`
		: "";
	const reset = print
		? "* { box-sizing: border-box; margin: 0; padding: 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }"
		: "* { box-sizing: border-box; margin: 0; padding: 0; }";
	const bodyStyle = print
		? "margin:0;padding:0"
		: `margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:${safeBg}`;
	const scaleStyle =
		surface.kind === "thumbnail"
			? `transform:scale(${surface.scale});transform-origin:top left;`
			: "";
	const frames = pageHtmls
		.map((html, index) => {
			const breakStyle =
				print && index > 0 ? "break-before:page;page-break-before:always;" : "";
			const style = [
				"box-sizing:border-box",
				"display:block",
				`width:${canvas.w}mm`,
				`height:${canvas.h}mm`,
				`background:${safeBg}`,
				"position:relative",
				"overflow:hidden",
				breakStyle,
				scaleStyle,
			]
				.filter(Boolean)
				.join(";");
			return `<${RENDER_PAGE_TAG} data-maket-render-page="${index + 1}" style="${style}">${html}</${RENDER_PAGE_TAG}>`;
		})
		.join("\n");

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  ${safeCharteCss}
  ${pageRule}
  ${reset}
</style>
</head>
<body style="${bodyStyle}">${frames}</body>
</html>`;
}
