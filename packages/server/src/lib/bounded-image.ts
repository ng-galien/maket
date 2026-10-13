/**
 * The frame of an image that travels inline in a tool answer: its longest
 * side at most INLINE_IMAGE_MAX_SIDE pixels and its base64 at most
 * INLINE_IMAGE_MAX_BASE64 bytes. Beyond a ratio of INLINE_IMAGE_MAX_RATIO
 * to 1 the image would become an unreadable strip, so the frame keeps the
 * top part (tall results) or the left part (wide results) instead. The
 * renderer that made the result draws the framed image itself (Chromium for
 * a page, resvg for a diagram): no full-size image is decoded in JavaScript,
 * so the event loop stays free.
 */

export const INLINE_IMAGE_MAX_SIDE = 1600;
export const INLINE_IMAGE_MAX_BASE64 = 1024 * 1024;
export const INLINE_IMAGE_MAX_RATIO = 2;

/** The region of the full result the inline image shows, and its scale. */
export interface InlineFrame {
	/** The region, in pixels of the full result. */
	region: { x: number; y: number; width: number; height: number };
	/** Inline pixels per pixel of the full result. */
	scale: number;
	/** Which part a cropped image keeps; null when it shows everything. */
	cropped: "top" | "left" | null;
	/** Size of the inline image. */
	width: number;
	height: number;
}

/** The frame of a result of `width`×`height` pixels; `maxScale` above 1
 * draws a small result larger, for legibility. */
export function inlineFrame(
	width: number,
	height: number,
	maxScale = 1,
): InlineFrame {
	const w = Math.max(1, width);
	const h = Math.max(1, height);
	const cropped =
		h / w > INLINE_IMAGE_MAX_RATIO
			? "top"
			: w / h > INLINE_IMAGE_MAX_RATIO
				? "left"
				: null;
	const region = {
		x: 0,
		y: 0,
		width: cropped === "left" ? h * INLINE_IMAGE_MAX_RATIO : w,
		height: cropped === "top" ? w * INLINE_IMAGE_MAX_RATIO : h,
	};
	const scale = Math.min(
		maxScale,
		INLINE_IMAGE_MAX_SIDE / Math.max(region.width, region.height),
	);
	return {
		region,
		scale,
		cropped,
		width: Math.max(1, Math.round(region.width * scale)),
		height: Math.max(1, Math.round(region.height * scale)),
	};
}

/** Whether an encoded image is small enough to travel inline. */
export function fitsInline(image: Buffer): boolean {
	return Math.ceil(image.length / 3) * 4 <= INLINE_IMAGE_MAX_BASE64;
}

/** Scales tried, from the frame's own downwards, until the image fits. */
export function inlineScales(frame: InlineFrame): number[] {
	return [1, 0.75, 0.5, 0.35, 0.25].map((factor) => frame.scale * factor);
}

/** The sentence describing the inline image of a result. */
export function inlineImageLine(
	frame: InlineFrame,
	image: { width: number; height: number },
	full: string,
): string {
	if (frame.cropped)
		return `Inline image cropped to the ${frame.cropped} part (${Math.round(frame.region.width)}×${Math.round(frame.region.height)} px of the full result, shown at ${image.width}×${image.height} px): ${full}.`;
	if (image.width < Math.round(frame.region.width))
		return `Inline image downscaled to ${image.width}×${image.height} px: ${full}.`;
	return `Inline image ${image.width}×${image.height} px.`;
}
