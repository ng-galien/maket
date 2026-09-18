import postcss from "postcss";
import { escapeCssValue, stripStyleClose } from "./css-escape.js";

export const RENDER_PAGE_TAG = "maket-render-page";

/** Body-level page declarations need to follow the new page root. */
function rebasePageRootSelectors(css: string): string {
	if (!/(?:\bhtml\b|\bbody\b|:root)/i.test(css)) return css;
	try {
		const stylesheet = postcss.parse(css);
		stylesheet.walkRules((rule) => {
			rule.selectors = rule.selectors.map((selector) =>
				selector.replace(
					/^(\s*)(?:(?:html|:root)\s+body|html|body|:root)(?=$|[\s>+~.#[:])/i,
					"$1:scope",
				),
			);
		});
		return stylesheet.toString();
	} catch {
		return css;
	}
}

function authoredImportUrl(params: string): string | undefined {
	const match = params.match(
		/^\s*(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)|"([^"]*)"|'([^']*)')/i,
	);
	return match?.slice(1).find((part) => part !== undefined);
}

function inlineDataCss(url: string): string | undefined {
	const match = url.match(/^data:(text\/css(?:;[^,]*)?),(.*)$/is);
	const header = match?.[1];
	const data = match?.[2];
	if (header === undefined || data === undefined) return undefined;
	try {
		const body = /;base64$/i.test(header)
			? Buffer.from(data, "base64").toString("utf8")
			: decodeURIComponent(data);
		return rebasePageRootSelectors(stripStyleClose(body));
	} catch {
		return undefined;
	}
}

function scopedPageCss(css: string, scope: string): string {
	const rebased = rebasePageRootSelectors(css);
	try {
		const stylesheet = postcss.parse(rebased);
		const fontImports: string[] = [];
		const dataImports: string[] = [];
		for (const rule of [...stylesheet.nodes]) {
			if (rule.type !== "atrule" || rule.name.toLowerCase() !== "import")
				continue;
			const url = authoredImportUrl(rule.params);
			const dataCss = url ? inlineDataCss(url) : undefined;
			if (dataCss !== undefined) dataImports.push(dataCss);
			else if (
				url &&
				/^https:\/\/fonts\.googleapis\.com\/css2?(?:\?|$)/i.test(url)
			) {
				const importCss = rule.toString().trim();
				fontImports.push(importCss.endsWith(";") ? importCss : `${importCss};`);
			}
			rule.remove();
		}
		const scopedCss = [...dataImports, stylesheet.toString()].join("\n");
		return `${fontImports.join("\n")}${fontImports.length ? "\n" : ""}@scope (${scope}) {\n${scopedCss}\n}`;
	} catch {
		return `@scope (${scope}) {\n${rebased}\n}`;
	}
}

/** Keep each authored style sheet on its own page in a multi-page print DOM. */
function scopeAuthoredStyles(html: string, pageNumber: number): string {
	const scope = `${RENDER_PAGE_TAG}[data-maket-render-page="${pageNumber}"]`;
	return html.replace(
		/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
		(_match, open: string, css: string, close: string) =>
			`${open}${scopedPageCss(css, scope)}${close}`,
	);
}

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
			const pageHtml =
				print && pageHtmls.length > 1
					? scopeAuthoredStyles(html, index + 1)
					: html;
			return `<${RENDER_PAGE_TAG} data-maket-render-page="${index + 1}" style="${style}">${pageHtml}</${RENDER_PAGE_TAG}>`;
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
