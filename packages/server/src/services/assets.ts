/**
 * assets — filesystem + image helpers bound to a specific `assetsDir`.
 *
 * Replaces the module-level helpers in `../images.ts` and `../context-token.ts`
 * that read `ASSETS_DIR` from config at module load. Each method respects the
 * injected `assetsDir`, which makes the service testable against a temp dir.
 *
 * Heavy deps (`jimp` for optimize) are loaded lazily inside their methods.
 */

import crypto from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { assertSafeUrl, boundedFetch } from "../lib/safe-fetch.js";
import { rasterizeSvg, svgNaturalDims } from "../lib/svg-rasterize.js";

const MIME_MAP: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".gif": "image/gif",
};

export const IMAGE_EXTS = new Set([
	".png",
	".jpg",
	".jpeg",
	".svg",
	".webp",
	".gif",
]);

const MAX_PX = 4000;
const THUMB_PX = 400;

/**
 * Thumbs are stored as `<source-filename>.thumb.<ext>` so that assets differing
 * only by extension (e.g. `logo.png` and `logo.jpg`) get distinct thumbs. The
 * thumb extension matches its content: JPEG for rasters (opaque, smaller),
 * PNG for SVG (preserves transparency + crisp edges typical of logos).
 * Legacy thumbs (`<basename>.jpg`, used before v1.1.0) are migrated at startup;
 * see `migrateLegacyThumbs` below.
 */
const thumbFilename = (filename: string) => {
	const ext = extname(filename).toLowerCase();
	return ext === ".svg" ? `${filename}.thumb.png` : `${filename}.thumb.jpg`;
};

export interface Dimensions {
	w: number;
	h: number;
}

export interface ReadResult {
	data: string;
	mime: string;
}

export interface AssetsService {
	/** Resolve `filename` inside `assetsDir`. Returns null if traversal escapes. */
	resolveSafePath(filename: string): string | null;
	/** True iff the file exists and is located inside `assetsDir`. */
	exists(filename: string): boolean;
	/** List files in `assetsDir` (top-level only) that have a recognized image extension. */
	listFilenames(): string[];
	/** Copy `source` into `assetsDir` as `dest`. Throws if `dest` exists and `overwrite` is false. */
	importFromLocal(
		source: string,
		dest: string,
		overwrite: boolean,
	): Promise<void>;
	/** Download from `url` into `assetsDir` as `dest`. Throws on non-2xx or if `dest` exists without overwrite. */
	importFromUrl(url: string, dest: string, overwrite: boolean): Promise<void>;
	/** Write an in-memory `buffer` into `assetsDir` as `dest`. Throws if `dest` exists and `overwrite` is false. */
	importBuffer(buffer: Buffer, dest: string, overwrite: boolean): Promise<void>;
	/** Delete the asset and its thumbnail (if present). */
	remove(filename: string): void;
	/** Read a file as base64 + mime, prefer thumbnail if available. Returns null if missing. */
	readBase64(filename: string, preferThumb?: boolean): ReadResult | null;
	/** True iff a thumbnail exists on disk for this asset. */
	hasThumb(filename: string): boolean;
	/** Map an extension to a MIME type. Falls back to image/png for unknown. */
	mimeFromExt(pathOrFilename: string): string;
	/**
	 * Probe the file bytes to confirm they decode as a real image of the
	 * declared extension. Magic-byte check + non-empty. Does NOT run a full
	 * decode (kept sync + cheap) — catches the common "text file renamed to
	 * .png" failure mode that otherwise blows up the MCP session when `view`
	 * returns the raw bytes inline to the model.
	 */
	validateImageFile(filename: string): { valid: boolean; reason?: string };
	/**
	 * Proof-of-read token for an image. HMAC over filename + size + mtime,
	 * signed with the per-process secret. Issued by `maket_image view` and
	 * required by `maket_image meta` to prove the agent read the binary
	 * before attributing metadata.
	 *
	 * Not optimistic concurrency control: the token doesn't protect against
	 * concurrent writes. It only proves that *some* read happened in this
	 * process's lifetime — the secret is regenerated on restart so tokens
	 * issued by a previous process are unverifiable.
	 *
	 * Null if the file is missing.
	 */
	imageToken(filename: string): string | null;
	/**
	 * Proof-of-read token for a charte (HMAC over name + JSON hash). Same
	 * semantics as `imageToken`: issued by `maket_charte view`, required by
	 * `maket_html set/patch` to prove the brand guide was consulted before
	 * the agent writes HTML against it. Not OCC. Null when no charte.
	 */
	charteToken(charte: { name: string } | null | undefined): string | null;
	/** Read natural dimensions from PNG/JPEG header. Null if unknown/missing. */
	getDimensions(filename: string): Dimensions | null;
	/** Optimize (resize + re-encode) in place + generate a thumbnail under `thumbs/`. */
	optimize(filename: string): Promise<Dimensions | null>;
	/**
	 * Rename thumbnails written under the pre-v1.1.0 convention (`<basename>.jpg`)
	 * to the current `<source-filename>.thumb.jpg` scheme. Returns counts for
	 * telemetry. Idempotent: safe to run on every boot.
	 */
	migrateLegacyThumbs(): {
		migrated: number;
		orphansDeleted: number;
		ambiguous: number;
	};
}

export interface AssetsServiceInputs {
	assetsDir: string;
	/** Override the HMAC secret. Default: random per-process (so tokens reset on restart). */
	secret?: string;
}

type SafePath = (filename: string) => string | null;

interface AssetPaths {
	thumbDir: () => string;
	safePath: SafePath;
	listFilenames: () => string[];
}

function createAssetPaths(assetsDir: string): AssetPaths {
	return {
		thumbDir: () => join(assetsDir, "thumbs"),
		safePath(filename) {
			const abs = resolve(join(assetsDir, filename));
			return abs.startsWith(resolve(assetsDir) + sep) ? abs : null;
		},
		listFilenames() {
			if (!existsSync(assetsDir)) return [];
			return readdirSync(assetsDir, { withFileTypes: true })
				.filter((d) => d.isFile())
				.map((d) => d.name)
				.filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()));
		},
	};
}

function importDestination(
	safePath: SafePath,
	dest: string,
	overwrite: boolean,
): string {
	const absDest = safePath(dest);
	if (!absDest) throw new Error(`Invalid destination: ${dest}`);
	if (existsSync(absDest) && !overwrite) {
		throw new Error(
			`Asset "${dest}" already exists. Use overwrite to replace.`,
		);
	}
	return absDest;
}

async function importAssetFromLocal(
	safePath: SafePath,
	source: string,
	dest: string,
	overwrite: boolean,
): Promise<void> {
	const absDest = importDestination(safePath, dest, overwrite);
	if (!existsSync(source)) throw new Error(`Source not found: ${source}`);
	copyFileSync(source, absDest);
}

async function importAssetFromUrl(
	safePath: SafePath,
	url: string,
	dest: string,
	overwrite: boolean,
): Promise<void> {
	const absDest = importDestination(safePath, dest, overwrite);
	await assertSafeUrl(url);
	const buffer = await boundedFetch(url);
	writeFileSync(absDest, buffer);
}

async function importAssetBuffer(
	safePath: SafePath,
	buffer: Buffer,
	dest: string,
	overwrite: boolean,
): Promise<void> {
	writeFileSync(importDestination(safePath, dest, overwrite), buffer);
}

function removeAsset(safePath: SafePath, filename: string): void {
	const abs = safePath(filename);
	if (abs && existsSync(abs)) unlinkSync(abs);
	const thumbAbs = safePath(join("thumbs", thumbFilename(filename)));
	if (thumbAbs && existsSync(thumbAbs)) unlinkSync(thumbAbs);
}

function readAssetBase64(
	safePath: SafePath,
	filename: string,
	preferThumb = true,
): ReadResult | null {
	const abs = safePath(filename);
	if (!abs || !existsSync(abs)) return null;
	const thumb = preferThumb
		? safePath(join("thumbs", thumbFilename(filename)))
		: null;
	const src = thumb && existsSync(thumb) ? thumb : abs;
	return {
		data: readFileSync(src).toString("base64"),
		mime: MIME_MAP[extname(src).toLowerCase()] ?? "image/png",
	};
}

function validateImageFile(
	safePath: SafePath,
	filename: string,
): { valid: boolean; reason?: string } {
	const abs = safePath(filename);
	if (!abs || !existsSync(abs))
		return { valid: false, reason: "File not found" };
	if (statSync(abs).size === 0) return { valid: false, reason: "Empty file" };
	const ext = extname(filename).toLowerCase();
	const head = readFileSync(abs, { flag: "r" }).subarray(0, 32);
	switch (ext) {
		case ".png":
			return validatePngHeader(head);
		case ".jpg":
		case ".jpeg":
			return validateJpegHeader(head);
		case ".gif":
			return validateGifHeader(head);
		case ".webp":
			return validateWebpHeader(head);
		case ".svg":
			return validateSvgFile(abs, head);
		default:
			return {
				valid: false,
				reason: `Unsupported format: ${ext || "(no extension)"} — supported: ${[...IMAGE_EXTS].sort().join(", ")}`,
			};
	}
}

function validatePngHeader(head: Buffer): { valid: boolean; reason?: string } {
	const valid =
		head[0] === 0x89 &&
		head[1] === 0x50 &&
		head[2] === 0x4e &&
		head[3] === 0x47 &&
		head[4] === 0x0d &&
		head[5] === 0x0a &&
		head[6] === 0x1a &&
		head[7] === 0x0a;
	return valid
		? { valid: true }
		: { valid: false, reason: "Not a valid PNG (bad magic bytes)" };
}

function validateJpegHeader(head: Buffer): { valid: boolean; reason?: string } {
	const valid = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
	return valid
		? { valid: true }
		: { valid: false, reason: "Not a valid JPEG (bad magic bytes)" };
}

function validateGifHeader(head: Buffer): { valid: boolean; reason?: string } {
	const magic = head.subarray(0, 6).toString("ascii");
	const valid = magic === "GIF87a" || magic === "GIF89a";
	return valid
		? { valid: true }
		: { valid: false, reason: "Not a valid GIF (bad magic bytes)" };
}

function validateWebpHeader(head: Buffer): { valid: boolean; reason?: string } {
	const riff = head.subarray(0, 4).toString("ascii");
	const webp = head.subarray(8, 12).toString("ascii");
	return riff === "RIFF" && webp === "WEBP"
		? { valid: true }
		: { valid: false, reason: "Not a valid WebP (bad RIFF/WEBP header)" };
}

function validateSvgFile(
	abs: string,
	head: Buffer,
): { valid: boolean; reason?: string } {
	const prefix = head.toString("utf8").trimStart().slice(0, 5).toLowerCase();
	if (
		!prefix.startsWith("<") ||
		(!prefix.startsWith("<?xml") && !prefix.startsWith("<svg"))
	) {
		return { valid: false, reason: "Not a valid SVG (missing <?xml or <svg)" };
	}
	const body = readFileSync(abs, "utf8");
	const dangerous =
		/<script[\s>]/i.test(body) ||
		/\son[a-z]+\s*=/i.test(body) ||
		/javascript:/i.test(body) ||
		/<foreignobject\b[^>]*?(?<!\/)>[\s\S]*?\S[\s\S]*?<\/foreignobject\s*>/i.test(
			body,
		);
	return dangerous
		? {
				valid: false,
				reason:
					"SVG contains active content (<script>, on* handler, javascript: URL, or non-empty <foreignObject>) — refused.",
			}
		: { valid: true };
}

function imageToken(
	safePath: SafePath,
	hmac: (payload: string) => string,
	filename: string,
): string | null {
	const abs = safePath(filename);
	if (!abs || !existsSync(abs)) return null;
	const stat = statSync(abs);
	return hmac(`image:${filename}|${stat.size}|${stat.mtimeMs}`);
}

function charteToken(
	hmac: (payload: string) => string,
	charte: { name: string } | null | undefined,
): string | null {
	if (!charte) return null;
	const content = JSON.stringify(charte);
	const hash = crypto.createHash("md5").update(content).digest("hex");
	return hmac(`charte:${charte.name}|${hash}`);
}

function getImageDimensions(
	safePath: SafePath,
	filename: string,
): Dimensions | null {
	const abs = safePath(filename);
	if (!abs || !existsSync(abs)) return null;
	try {
		const buf = readFileSync(abs);
		if (buf[0] === 0x89 && buf[1] === 0x50) {
			return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
		}
		let i = 2;
		while (i < buf.length - 9) {
			if (buf[i] === 0xff && (buf[i + 1] === 0xc0 || buf[i + 1] === 0xc2)) {
				return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
			}
			i += buf[i + 1] === 0xff ? 1 : 2 + buf.readUInt16BE(i + 2);
		}
	} catch {}
	return null;
}

async function optimizeAsset(
	paths: AssetPaths,
	filename: string,
): Promise<Dimensions | null> {
	const ext = extname(filename).toLowerCase();
	if (ext === ".gif") return null;
	const abs = paths.safePath(filename);
	if (!abs || !existsSync(abs)) return null;
	const td = paths.thumbDir();
	if (!existsSync(td)) mkdirSync(td, { recursive: true });
	const thumbPath = join(td, thumbFilename(filename));
	return ext === ".svg"
		? optimizeSvg(abs, thumbPath)
		: optimizeRaster(abs, thumbPath, ext);
}

async function optimizeSvg(
	abs: string,
	thumbPath: string,
): Promise<Dimensions | null> {
	try {
		const svg = readFileSync(abs);
		writeFileSync(thumbPath, await rasterizeSvg(svg, THUMB_PX));
		return svgNaturalDims(svg);
	} catch {
		return null;
	}
}

async function optimizeRaster(
	abs: string,
	thumbPath: string,
	ext: string,
): Promise<Dimensions | null> {
	try {
		const { Jimp } = await import("jimp");
		const image = await Jimp.read(abs);
		const { width, height } = image;
		if (width > MAX_PX || height > MAX_PX) {
			image.scaleToFit({ w: MAX_PX, h: MAX_PX });
		}
		if (ext !== ".png") {
			const buf = await image.getBuffer("image/jpeg", { quality: 85 });
			writeFileSync(abs, buf);
		}
		const thumb = image.clone();
		thumb.scaleToFit({ w: THUMB_PX, h: THUMB_PX * 4 });
		const thumbBuf = await thumb.getBuffer("image/jpeg", { quality: 75 });
		writeFileSync(thumbPath, thumbBuf);
		return { w: image.width, h: image.height };
	} catch {
		return null;
	}
}

function migrateLegacyThumbs(paths: AssetPaths): {
	migrated: number;
	orphansDeleted: number;
	ambiguous: number;
} {
	const td = paths.thumbDir();
	if (!existsSync(td)) return { migrated: 0, orphansDeleted: 0, ambiguous: 0 };
	const result = { migrated: 0, orphansDeleted: 0, ambiguous: 0 };
	const sourcesByBase = sourcesGroupedByBase(paths.listFilenames());
	for (const entry of readdirSync(td, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".jpg")) continue;
		if (isNewConventionThumb(entry.name)) continue;
		migrateLegacyThumb(entry.name, td, sourcesByBase, paths.safePath, result);
	}
	return result;
}

function sourcesGroupedByBase(sources: string[]): Map<string, string[]> {
	const sourcesByBase = new Map<string, string[]>();
	for (const f of sources) {
		const base = f.replace(/\.[^.]+$/, "");
		const list = sourcesByBase.get(base) ?? [];
		list.push(f);
		sourcesByBase.set(base, list);
	}
	return sourcesByBase;
}

function isNewConventionThumb(name: string): boolean {
	if (!name.endsWith(".thumb.jpg")) return false;
	const sourceName = name.slice(0, -".thumb.jpg".length);
	return IMAGE_EXTS.has(extname(sourceName).toLowerCase());
}

function migrateLegacyThumb(
	name: string,
	thumbDirPath: string,
	sourcesByBase: Map<string, string[]>,
	safePath: SafePath,
	result: { migrated: number; orphansDeleted: number; ambiguous: number },
): void {
	const base = name.slice(0, -".jpg".length);
	const matching = sourcesByBase.get(base) ?? [];
	const legacyPath = join(thumbDirPath, name);
	try {
		if (matching.length === 0) {
			unlinkSync(legacyPath);
			result.orphansDeleted += 1;
			return;
		}
		if (matching.length > 1) {
			result.ambiguous += 1;
			return;
		}
		const onlyMatch = matching[0];
		if (!onlyMatch) return;
		const targetPath = safePath(join("thumbs", thumbFilename(onlyMatch)));
		if (!targetPath) return;
		if (existsSync(targetPath)) {
			unlinkSync(legacyPath);
			result.orphansDeleted += 1;
		} else {
			renameSync(legacyPath, targetPath);
			result.migrated += 1;
		}
	} catch {}
}

export function createAssetsService(
	inputs: AssetsServiceInputs,
): AssetsService {
	const paths = createAssetPaths(inputs.assetsDir);
	const secret = inputs.secret ?? crypto.randomUUID();
	const hmac = (payload: string) =>
		crypto
			.createHmac("sha256", secret)
			.update(payload)
			.digest("hex")
			.slice(0, 16);

	return {
		resolveSafePath: paths.safePath,
		exists(filename) {
			const p = paths.safePath(filename);
			return !!p && existsSync(p);
		},
		listFilenames: paths.listFilenames,
		importFromLocal: (source, dest, overwrite) =>
			importAssetFromLocal(paths.safePath, source, dest, overwrite),
		importFromUrl: (url, dest, overwrite) =>
			importAssetFromUrl(paths.safePath, url, dest, overwrite),
		importBuffer: (buffer, dest, overwrite) =>
			importAssetBuffer(paths.safePath, buffer, dest, overwrite),
		remove: (filename) => removeAsset(paths.safePath, filename),
		readBase64: (filename, preferThumb = true) =>
			readAssetBase64(paths.safePath, filename, preferThumb),
		hasThumb(filename) {
			const thumb = paths.safePath(join("thumbs", thumbFilename(filename)));
			return !!thumb && existsSync(thumb);
		},
		mimeFromExt: (pathOrFilename) =>
			MIME_MAP[extname(pathOrFilename).toLowerCase()] ?? "image/png",
		validateImageFile: (filename) =>
			validateImageFile(paths.safePath, filename),
		imageToken: (filename) => imageToken(paths.safePath, hmac, filename),
		charteToken: (charte) => charteToken(hmac, charte),
		getDimensions: (filename) => getImageDimensions(paths.safePath, filename),
		optimize: (filename) => optimizeAsset(paths, filename),
		migrateLegacyThumbs: () => migrateLegacyThumbs(paths),
	};
}

/**
 * Proof-of-read token validators — decoupled from filesystem, pure logic.
 *
 * The contract these guards enforce: "the agent must have read the resource
 * (asset / charte) in this server's lifetime before being allowed to write
 * derived data". This is NOT optimistic concurrency control — there is no
 * version vector, and a token re-issued after a no-op read passes the check.
 * The guarantee is on read-before-write, not on intervening-write detection.
 */

export function validateAssetToken(
	filename: string,
	token: string | undefined,
	currentToken: string | null,
): { valid: boolean; reason?: string } {
	if (currentToken === null) return { valid: true };
	if (!token) {
		return {
			valid: false,
			reason: `Token required. Read the asset first with maket_image view "${filename}" before writing.`,
		};
	}
	if (currentToken === token) return { valid: true };
	return {
		valid: false,
		reason: `Token stale — content has changed. Re-read with maket_image view "${filename}".`,
	};
}

export function validateCharteToken(
	name: string,
	token: string | undefined,
	currentToken: string | null,
): { valid: boolean; reason?: string } {
	if (currentToken === null) return { valid: true };
	if (!token) {
		return {
			valid: false,
			reason: `Token required. Read the charte first with maket_charte view "${name}" before writing.`,
		};
	}
	if (currentToken === token) return { valid: true };
	return {
		valid: false,
		reason: `Token stale — content has changed. Re-read with maket_charte view "${name}".`,
	};
}
