/**
 * SVG → PNG rasterizer. Anthropic's vision API and Jimp both reject raw SVG,
 * so we rasterize to PNG whenever we need a pixel preview (MCP thumb, HTTP
 * thumb/preview cache). PNG preserves transparency and sharp edges — better
 * than JPEG for logos, which is the dominant SVG use-case in this app.
 *
 * resvg-js is WASM-backed, so no native toolchain required.
 */

export async function rasterizeSvg(
	svg: Buffer,
	maxPx: number,
): Promise<Buffer> {
	const { Resvg } = await import("@resvg/resvg-js");
	const resvg = new Resvg(svg, {
		fitTo: { mode: "width", value: maxPx },
		font: { loadSystemFonts: false },
	});
	return resvg.render().asPng();
}

/**
 * Parse natural dimensions from an SVG's root `<svg>` tag. Prefers explicit
 * `width`/`height`, falls back to `viewBox`. Returns null when neither is
 * parseable (rare — but means our stored metadata has no dims for this asset).
 */
export function svgNaturalDims(svg: Buffer): { w: number; h: number } | null {
	const head = svg.toString("utf8", 0, 4096);
	const svgTag = head.match(/<svg\b[^>]*>/i)?.[0];
	if (!svgTag) return null;
	const width = svgTag.match(/\bwidth\s*=\s*["']?([\d.]+)/)?.[1];
	const height = svgTag.match(/\bheight\s*=\s*["']?([\d.]+)/)?.[1];
	if (width && height) {
		const w = Math.round(Number(width));
		const h = Math.round(Number(height));
		if (w > 0 && h > 0) return { w, h };
	}
	const viewBox = svgTag.match(/\bviewBox\s*=\s*["']?([^"']+)/)?.[1];
	if (viewBox) {
		const parts = viewBox
			.trim()
			.split(/[\s,]+/)
			.map(Number);
		const [, , vbW, vbH] = parts;
		if (parts.length === 4 && vbW && vbH && vbW > 0 && vbH > 0) {
			return { w: Math.round(vbW), h: Math.round(vbH) };
		}
	}
	return null;
}
