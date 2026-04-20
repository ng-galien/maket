/**
 * Canvas format table shared by the server (persistence, MCP tools) and the
 * client (thumbnail aspect ratios, UI format chips). This is intentionally
 * data-only: a static lookup that both sides need to agree on to render the
 * same physical sheet.
 *
 * Sizes are millimetres. Screen formats ignore orientation (DESKTOP/TABLET/
 * MOBILE have a fixed aspect).
 */

export const PORTRAIT = "portrait";
export const LANDSCAPE = "landscape";
export const ORIENTATIONS = [PORTRAIT, LANDSCAPE] as const;
export type Orientation = (typeof ORIENTATIONS)[number];
export const DEFAULT_ORIENTATION: Orientation = PORTRAIT;

export const FORMATS: Record<string, { w: number; h: number }> = {
	A2: { w: 420, h: 594 },
	A3: { w: 297, h: 420 },
	A4: { w: 210, h: 297 },
	A5: { w: 148, h: 210 },
	A6: { w: 105, h: 148 },
	A7: { w: 74, h: 105 },
	A8: { w: 52, h: 74 },
	DESKTOP: { w: 288, h: 205 },
	TABLET: { w: 167, h: 239 },
	MOBILE: { w: 79, h: 170 },
};

export const SCREEN_FORMATS = new Set(["DESKTOP", "TABLET", "MOBILE"]);

const DEFAULT_DIMS = { w: 297, h: 420 }; // A3

/** Compute canvas width/height from format + orientation. Screen formats
 * ignore orientation. */
export function computeCanvasDims(
	format: string,
	orientation: string,
): { w: number; h: number } {
	const f = FORMATS[format] ?? DEFAULT_DIMS;
	const isLandscape = orientation === LANDSCAPE && !SCREEN_FORMATS.has(format);
	return { w: isLandscape ? f.h : f.w, h: isLandscape ? f.w : f.h };
}
