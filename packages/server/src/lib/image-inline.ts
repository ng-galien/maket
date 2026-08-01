/**
 * image-inline — replace `/assets/<file>` references in HTML with inline
 * data-URIs so puppeteer can render them without a same-origin fetch.
 *
 * Shared by PdfService and ThumbnailService: both need to render a
 * Document via `page.setContent(...)` without leaning on a local HTTP
 * server. Jimp downscales raster images to the target page's pixel size
 * (width/height in mm × dpi / 25.4) so PDFs and thumbs stay small.
 *
 * SVGs are passed through untouched (always tiny, usually vector-source).
 */

import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

export interface InlineImagesOptions {
	/** Directory where `/assets/<file>` maps to `<assetsDir>/<file>`. */
	assetsDir: string;
	/** Target page dimensions in millimetres. Images wider/taller than the
	 * corresponding pixel budget are downscaled. */
	pageMm: { w: number; h: number };
	/** Device pixels per inch. 96 = screen, 150 = print, 300 = HD. */
	dpi: number;
	/** Override for `mime-type-by-extension` — used by the assets service
	 * already, injected so we don't reach into another layer. */
	mimeFromExt: (filename: string) => string;
}

/**
 * Swap every `/assets/<file>` reference in `html` with a `data:<mime>;base64,…`
 * URI. Missing files are left untouched so the caller can detect them later.
 */
export async function inlineImages(
	html: string,
	opts: InlineImagesOptions,
): Promise<string> {
	const maxW = Math.ceil((opts.pageMm.w * opts.dpi) / 25.4);
	const maxH = Math.ceil((opts.pageMm.h * opts.dpi) / 25.4);
	const srcRegex = /\/assets\/([^"')\s]+\.(?:jpg|jpeg|png|webp|svg|gif))/gi;
	const matches = [...html.matchAll(srcRegex)];
	if (!matches.length) return html;

	const filenames = [
		...new Set(matches.map((m) => m[1]).filter((f): f is string => !!f)),
	];
	const dataUris = new Map<string, string>();

	const { Jimp } = await import("jimp");

	await Promise.all(
		filenames.map(async (filename) => {
			const dataUri = await dataUriForAsset(filename, opts, maxW, maxH, Jimp);
			if (dataUri) dataUris.set(filename, dataUri);
		}),
	);

	let result = html;
	for (const [filename, dataUri] of dataUris) {
		result = result.replaceAll(`/assets/${filename}`, dataUri);
	}
	return result;
}

type JimpCtor = typeof import("jimp")["Jimp"];

async function dataUriForAsset(
	filename: string,
	opts: InlineImagesOptions,
	maxW: number,
	maxH: number,
	Jimp: JimpCtor,
): Promise<string | null> {
	const absPath = join(opts.assetsDir, filename);
	if (!existsSync(absPath)) return null;
	try {
		const ext = extname(filename).toLowerCase();
		if (ext === ".svg") {
			const b64 = readFileSync(absPath).toString("base64");
			return `data:image/svg+xml;base64,${b64}`;
		}
		const image = await Jimp.read(absPath);
		if (image.width > maxW || image.height > maxH) {
			image.scaleToFit({ w: maxW, h: maxH });
		}
		const isPng = ext === ".png";
		const buf = isPng
			? await image.getBuffer("image/png")
			: await image.getBuffer("image/jpeg", { quality: 80 });
		const mime = isPng ? "image/png" : "image/jpeg";
		return `data:${mime};base64,${buf.toString("base64")}`;
	} catch {
		const b64 = readFileSync(absPath).toString("base64");
		return `data:${opts.mimeFromExt(absPath)};base64,${b64}`;
	}
}
