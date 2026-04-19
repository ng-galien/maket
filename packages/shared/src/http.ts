/**
 * HTTP JSON response contract for maket's public API.
 *
 * Charte and asset metadata stay partially opaque — each side narrows to its
 * own domain shape (server persistence vs client UI). Only the fields that
 * are definitely on the wire (discriminating keys) are declared.
 */

export interface HttpErrorResponse {
	error: string;
}

/**
 * Stored charter — identified by `name`. The rest of the fields (tokens,
 * voice, rules, css, description) are persisted/parsed as JSON and narrowed
 * on whichever side cares about them, so we don't re-declare the full shape
 * here and re-introduce the server/client divergence trap.
 */
export interface ChartesListItem {
	name: string;
}

/** GET /api/chartes */
export type ChartesListResponse = ChartesListItem[];

/** GET /api/charte/:name */
export type CharteGetResponse = ChartesListItem | HttpErrorResponse;

/** Entry in the assets listing (everything on the filesystem + optional DB metadata). */
export interface AssetsListItem {
	file: string;
	filename?: string;
	title?: string | null;
	description?: string | null;
	category?: string | null;
	tags?: string[];
	credit?: string | null;
	width?: number | null;
	height?: number | null;
	orientation?: string | null;
	created_at?: string;
}

/** GET /api/assets */
export interface AssetsListResponse {
	images: AssetsListItem[];
}

/** POST /api/upload — success. */
export interface UploadSuccessResponse {
	ok: true;
	file: string;
	replaced: boolean;
}

/** POST /api/upload — full response. */
export type UploadResponse = UploadSuccessResponse | HttpErrorResponse;
