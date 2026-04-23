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
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { assertSafeUrl, boundedFetch } from "../lib/safe-fetch.js";

const MIME_MAP: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".gif": "image/gif",
};

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif"]);

const MAX_PX = 4000;
const THUMB_PX = 400;

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
	/** Compute a short HMAC token of filename + size + mtime. Null if file missing. */
	imageToken(filename: string): string | null;
	/** Compute a short HMAC token of a charte's name + JSON hash. Null when no charte. */
	charteToken(charte: { name: string } | null | undefined): string | null;
	/** Read natural dimensions from PNG/JPEG header. Null if unknown/missing. */
	getDimensions(filename: string): Dimensions | null;
	/** Optimize (resize + re-encode) in place + generate a thumbnail under `thumbs/`. */
	optimize(filename: string): Promise<Dimensions | null>;
}

export interface AssetsServiceInputs {
	assetsDir: string;
	/** Override the HMAC secret. Default: random per-process (so tokens reset on restart). */
	secret?: string;
}

export function createAssetsService(
	inputs: AssetsServiceInputs,
): AssetsService {
	const { assetsDir } = inputs;
	const secret = inputs.secret ?? crypto.randomUUID();
	const thumbDir = () => join(assetsDir, "thumbs");

	function hmac(payload: string): string {
		return crypto
			.createHmac("sha256", secret)
			.update(payload)
			.digest("hex")
			.slice(0, 16);
	}

	function safePath(filename: string): string | null {
		const abs = resolve(join(assetsDir, filename));
		return abs.startsWith(resolve(assetsDir) + sep) ? abs : null;
	}

	return {
		resolveSafePath: safePath,

		exists(filename) {
			const p = safePath(filename);
			return !!p && existsSync(p);
		},

		listFilenames() {
			if (!existsSync(assetsDir)) return [];
			return readdirSync(assetsDir, { withFileTypes: true })
				.filter((d) => d.isFile())
				.map((d) => d.name)
				.filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()));
		},

		async importFromLocal(source, dest, overwrite) {
			const absDest = safePath(dest);
			if (!absDest) throw new Error(`Invalid destination: ${dest}`);
			if (existsSync(absDest) && !overwrite) {
				throw new Error(
					`Asset "${dest}" already exists. Use overwrite to replace.`,
				);
			}
			if (!existsSync(source)) throw new Error(`Source not found: ${source}`);
			copyFileSync(source, absDest);
		},

		async importFromUrl(url, dest, overwrite) {
			const absDest = safePath(dest);
			if (!absDest) throw new Error(`Invalid destination: ${dest}`);
			if (existsSync(absDest) && !overwrite) {
				throw new Error(
					`Asset "${dest}" already exists. Use overwrite to replace.`,
				);
			}
			await assertSafeUrl(url);
			const buffer = await boundedFetch(url);
			writeFileSync(absDest, buffer);
		},

		async importBuffer(buffer, dest, overwrite) {
			const absDest = safePath(dest);
			if (!absDest) throw new Error(`Invalid destination: ${dest}`);
			if (existsSync(absDest) && !overwrite) {
				throw new Error(
					`Asset "${dest}" already exists. Use overwrite to replace.`,
				);
			}
			writeFileSync(absDest, buffer);
		},

		remove(filename) {
			const abs = safePath(filename);
			if (abs && existsSync(abs)) unlinkSync(abs);
			const thumbAbs = safePath(join("thumbs", filename));
			if (thumbAbs && existsSync(thumbAbs)) unlinkSync(thumbAbs);
		},

		readBase64(filename, preferThumb = true) {
			const abs = safePath(filename);
			if (!abs || !existsSync(abs)) return null;
			const thumbName = filename.replace(/\.[^.]+$/, ".jpg");
			const thumb = preferThumb ? safePath(join("thumbs", thumbName)) : null;
			const src = thumb && existsSync(thumb) ? thumb : abs;
			return {
				data: readFileSync(src).toString("base64"),
				mime: MIME_MAP[extname(src).toLowerCase()] ?? "image/png",
			};
		},

		mimeFromExt(pathOrFilename) {
			return MIME_MAP[extname(pathOrFilename).toLowerCase()] ?? "image/png";
		},

		validateImageFile(filename) {
			const abs = safePath(filename);
			if (!abs || !existsSync(abs)) {
				return { valid: false, reason: "File not found" };
			}
			const stat = statSync(abs);
			if (stat.size === 0) {
				return { valid: false, reason: "Empty file" };
			}
			const ext = extname(filename).toLowerCase();
			const head = readFileSync(abs, { flag: "r" }).subarray(0, 32);
			switch (ext) {
				case ".png":
					if (
						head[0] !== 0x89 ||
						head[1] !== 0x50 ||
						head[2] !== 0x4e ||
						head[3] !== 0x47 ||
						head[4] !== 0x0d ||
						head[5] !== 0x0a ||
						head[6] !== 0x1a ||
						head[7] !== 0x0a
					) {
						return {
							valid: false,
							reason: "Not a valid PNG (bad magic bytes)",
						};
					}
					return { valid: true };
				case ".jpg":
				case ".jpeg":
					if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) {
						return {
							valid: false,
							reason: "Not a valid JPEG (bad magic bytes)",
						};
					}
					return { valid: true };
				case ".gif": {
					const magic = head.subarray(0, 6).toString("ascii");
					if (magic !== "GIF87a" && magic !== "GIF89a") {
						return {
							valid: false,
							reason: "Not a valid GIF (bad magic bytes)",
						};
					}
					return { valid: true };
				}
				case ".webp": {
					const riff = head.subarray(0, 4).toString("ascii");
					const webp = head.subarray(8, 12).toString("ascii");
					if (riff !== "RIFF" || webp !== "WEBP") {
						return {
							valid: false,
							reason: "Not a valid WebP (bad RIFF/WEBP header)",
						};
					}
					return { valid: true };
				}
				case ".svg": {
					const prefix = head
						.toString("utf8")
						.trimStart()
						.slice(0, 5)
						.toLowerCase();
					if (
						!prefix.startsWith("<") ||
						(!prefix.startsWith("<?xml") && !prefix.startsWith("<svg"))
					) {
						return {
							valid: false,
							reason: "Not a valid SVG (missing <?xml or <svg)",
						};
					}
					// SVG can carry executable content (script tags, on* handlers,
					// javascript: hrefs). When the SVG is later inlined via
					// dangerouslySetInnerHTML or rendered by puppeteer with
					// network access, that content runs. Reject anything that
					// smells executable rather than try to sanitise.
					const body = readFileSync(abs, "utf8");
					const dangerous =
						/<script[\s>]/i.test(body) ||
						/\son[a-z]+\s*=/i.test(body) ||
						/javascript:/i.test(body) ||
						/<foreignobject[\s>]/i.test(body);
					if (dangerous) {
						return {
							valid: false,
							reason:
								"SVG contains active content (<script>, on* handler, javascript: URL, or <foreignObject>) — refused.",
						};
					}
					return { valid: true };
				}
				default:
					return { valid: true };
			}
		},

		imageToken(filename) {
			const abs = safePath(filename);
			if (!abs || !existsSync(abs)) return null;
			const stat = statSync(abs);
			return hmac(`image:${filename}|${stat.size}|${stat.mtimeMs}`);
		},

		charteToken(charte) {
			if (!charte) return null;
			const content = JSON.stringify(charte);
			const hash = crypto.createHash("md5").update(content).digest("hex");
			return hmac(`charte:${charte.name}|${hash}`);
		},

		getDimensions(filename) {
			const abs = safePath(filename);
			if (!abs || !existsSync(abs)) return null;
			try {
				const buf = readFileSync(abs);
				// PNG: width at offset 16 (4 bytes BE), height at offset 20
				if (buf[0] === 0x89 && buf[1] === 0x50) {
					return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
				}
				// JPEG: scan for SOF0/SOF2 marker
				let i = 2;
				while (i < buf.length - 9) {
					if (buf[i] === 0xff && (buf[i + 1] === 0xc0 || buf[i + 1] === 0xc2)) {
						return {
							w: buf.readUInt16BE(i + 7),
							h: buf.readUInt16BE(i + 5),
						};
					}
					i += buf[i + 1] === 0xff ? 1 : 2 + buf.readUInt16BE(i + 2);
				}
			} catch {}
			return null;
		},

		async optimize(filename) {
			const ext = extname(filename).toLowerCase();
			if ([".svg", ".gif"].includes(ext)) return null;
			const abs = safePath(filename);
			if (!abs || !existsSync(abs)) return null;
			try {
				const { Jimp } = await import("jimp");
				const image = await Jimp.read(abs);
				const { width, height } = image;
				if (width > MAX_PX || height > MAX_PX) {
					image.scaleToFit({ w: MAX_PX, h: MAX_PX });
				}
				const isPng = ext === ".png";
				if (!isPng) {
					const buf = await image.getBuffer("image/jpeg", { quality: 85 });
					writeFileSync(abs, buf);
				}
				// Generate thumbnail
				const td = thumbDir();
				if (!existsSync(td)) mkdirSync(td, { recursive: true });
				const thumbPath = join(td, filename.replace(/\.[^.]+$/, ".jpg"));
				const thumb = image.clone();
				thumb.scaleToFit({ w: THUMB_PX, h: THUMB_PX * 4 });
				const thumbBuf = await thumb.getBuffer("image/jpeg", { quality: 75 });
				writeFileSync(thumbPath, thumbBuf);
				return { w: image.width, h: image.height };
			} catch {
				return null;
			}
		},
	};
}

/**
 * Token validators — decoupled from filesystem, pure logic.
 */

export function validateAssetToken(
	filename: string,
	token: string | undefined,
	currentToken: string | null,
): { valid: boolean; reason?: string } {
	if (currentToken === null) return { valid: true }; // first creation
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
