/**
 * assets routes — static serving + thumb/preview variants + metadata listing +
 * upload. Background optimization runs after writes via `assets.optimize`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
// SQLite `assets` table is the single source of truth for image metadata.
// The legacy `${ASSETS_DIR}/metadata.json` sidecar was append-only and never
// read at runtime — removed.
import { extname, join, resolve, sep } from "node:path";
import type { AssetsListResponse, UploadResponse } from "@maket/shared";
import type { Request, Response } from "express";
import express, { Router as createRouter, type Router } from "express";
import { BodyTooLargeError, readBoundedBody } from "../lib/bounded-body.js";
import { rasterizeSvg } from "../lib/svg-rasterize.js";
import type { AssetsService } from "../services/assets.js";
import type { Bus } from "../services/bus.js";
import type { Config } from "../services/config.js";
import type { Store } from "../services/store.js";

// Single image cap. ~32 MB lets a high-res photo through; well below "fill
// the disk" or "fill the heap" territory.
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

export interface AssetsRouterDeps {
	config: Config;
	store: Store;
	bus: Bus;
	assets: AssetsService;
}

const ALLOWED_IMG_EXTS = new Set([
	".png",
	".jpg",
	".jpeg",
	".svg",
	".webp",
	".gif",
]);

const RESERVED_NAMES = new Set(["thumbs"]);

const VARIANTS: Record<
	string,
	{ maxPx: number; quality: number; subdir: string }
> = {
	thumb: { maxPx: 400, quality: 75, subdir: "thumbs" },
	preview: { maxPx: 2000, quality: 85, subdir: "preview" },
};

const log = (...a: unknown[]) =>
	process.stderr.write(`${a.map(String).join(" ")}\n`);

export function createAssetsRouter({
	config,
	store,
	bus,
	assets,
}: AssetsRouterDeps): Router {
	const router = createRouter();
	const { ASSETS_DIR } = config;

	router.get("/assets/thumb/:file", (req, res) =>
		handleAssetVariant(req, res, ASSETS_DIR, "thumb"),
	);
	router.get("/assets/preview/:file", (req, res) =>
		handleAssetVariant(req, res, ASSETS_DIR, "preview"),
	);

	router.use("/assets", express.static(ASSETS_DIR, { maxAge: 0, etag: true }));

	router.get("/api/assets", (_req, res) => listAssets(res, store, assets));
	router.post("/api/upload", (req, res) => handleUpload(req, res, assets, bus));

	return router;
}

async function handleAssetVariant(
	req: Request,
	res: Response,
	assetsDir: string,
	variant: "thumb" | "preview",
): Promise<void> {
	const { file } = req.params as { file: string };
	const original = resolve(join(assetsDir, file));
	if (!original.startsWith(resolve(assetsDir) + sep)) {
		res.status(400).end();
		return;
	}
	if (!existsSync(original)) {
		res.status(404).end();
		return;
	}
	const cfg = VARIANTS[variant];
	if (!cfg) {
		res.status(400).end();
		return;
	}
	await sendAssetVariant(res, original, file, variant, assetsDir, cfg);
}

async function sendAssetVariant(
	res: Response,
	original: string,
	file: string,
	variant: string,
	assetsDir: string,
	cfg: { maxPx: number; quality: number; subdir: string },
): Promise<void> {
	const cacheDir = join(assetsDir, cfg.subdir);
	const isSvg = extname(file).toLowerCase() === ".svg";
	const contentType = isSvg ? "image/png" : "image/jpeg";
	const cached = join(
		cacheDir,
		file.replace(/\.[^.]+$/, isSvg ? ".png" : ".jpg"),
	);
	if (existsSync(cached)) {
		sendCachedAsset(res, cached, contentType);
		return;
	}
	try {
		const buf = await renderVariantBuffer(
			original,
			cfg.maxPx,
			cfg.quality,
			isSvg,
		);
		if (!buf) {
			sendCachedAsset(res, original, "");
			return;
		}
		if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
		writeFileSync(cached, buf);
		sendCachedAsset(res, cached, contentType);
	} catch (err: any) {
		log(`[variant] ${variant}/${file} failed: ${err.message}`);
		res.sendFile(original);
	}
}

function sendCachedAsset(
	res: Response,
	file: string,
	contentType: string,
): void {
	if (contentType) res.setHeader("Content-Type", contentType);
	res.setHeader("Cache-Control", "public, max-age=86400");
	res.sendFile(file);
}

async function renderVariantBuffer(
	original: string,
	maxPx: number,
	quality: number,
	isSvg: boolean,
): Promise<Buffer | null> {
	if (isSvg) return rasterizeSvg(readFileSync(original), maxPx);
	const { Jimp } = await import("jimp");
	const image = await Jimp.read(original);
	if (image.width <= maxPx && image.height <= maxPx) return null;
	image.scaleToFit({ w: maxPx, h: maxPx });
	return Buffer.from(await image.getBuffer("image/jpeg", { quality }));
}

function listAssets(
	res: Response<AssetsListResponse>,
	store: Store,
	assets: AssetsService,
): void {
	const files = assets.listFilenames();
	const dbAssets = store.loadAllAssets();
	const images = files.map((f) => {
		const meta = dbAssets.find((a) => a.filename === f);
		return meta ? { file: f, ...meta } : { file: f };
	});
	res.json({ images });
}

async function handleUpload(
	req: Request,
	res: Response<UploadResponse>,
	assets: AssetsService,
	bus: Bus,
): Promise<void> {
	try {
		const upload = await readUpload(req, res);
		if (!upload) return;
		const invalid = validateUploadName(upload.cleanName);
		if (invalid) {
			res.status(400).json({ error: invalid });
			return;
		}
		const replaced = assets.exists(upload.cleanName);
		await assets.importBuffer(upload.buf, upload.cleanName, true);
		setTimeout(() => void assets.optimize(upload.cleanName), 0);
		bus.emit("assets:changed", {});
		log(
			`${replaced ? "Replaced" : "Uploaded"}: ${upload.cleanName} (${upload.buf.length} bytes)`,
		);
		res.json({ ok: true, file: upload.cleanName, replaced });
	} catch (e: any) {
		res.status(500).json({ error: e.message });
	}
}

async function readUpload(
	req: Request,
	res: Response<UploadResponse>,
): Promise<{ cleanName: string; buf: Buffer } | null> {
	const contentType = req.headers["content-type"] || "";
	if (contentType.includes("multipart/form-data"))
		return readMultipartUpload(req, res, contentType);
	return readJsonUpload(req, res);
}

async function readBoundedUploadBody(
	req: Request,
	res: Response<UploadResponse>,
): Promise<Buffer | null> {
	try {
		return await readBoundedBody(req, MAX_UPLOAD_BYTES);
	} catch (e) {
		if (e instanceof BodyTooLargeError) {
			res.status(413).json({ error: e.message });
			return null;
		}
		throw e;
	}
}

async function readMultipartUpload(
	req: Request,
	res: Response<UploadResponse>,
	contentType: string,
): Promise<{ cleanName: string; buf: Buffer } | null> {
	const body = await readBoundedUploadBody(req, res);
	if (!body) return null;
	const boundary = contentType.split("boundary=")[1];
	if (!boundary) {
		res.status(400).json({ error: "Missing boundary" });
		return null;
	}
	return parseMultipartUpload(body, boundary, res);
}

function parseMultipartUpload(
	body: Buffer,
	boundary: string,
	res: Response<UploadResponse>,
): { cleanName: string; buf: Buffer } | null {
	const partSep = `--${boundary}`;
	const parts = body
		.toString("latin1")
		.split(partSep)
		.filter((p) => p.includes("Content-Disposition"));
	if (parts.length === 0) {
		res.status(400).json({ error: "No file in upload" });
		return null;
	}
	const part = parts[0];
	if (!part) {
		res.status(400).json({ error: "No file part" });
		return null;
	}
	return parseMultipartPart(body, part, partSep, res);
}

// code-moniker: ignore[smell-feature-envy-local]
// HTTP handler `parseMultipartPart`: request/response adapter over services, not envied domain logic.
function parseMultipartPart(
	body: Buffer,
	part: string,
	partSep: string,
	res: Response<UploadResponse>,
): { cleanName: string; buf: Buffer } | null {
	const headerEnd = part.indexOf("\r\n\r\n");
	if (headerEnd === -1) {
		res.status(400).json({ error: "Malformed multipart" });
		return null;
	}
	const filenameMatch = part.slice(0, headerEnd).match(/filename="([^"]+)"/);
	if (!filenameMatch?.[1]) {
		res.status(400).json({ error: "No filename in upload" });
		return null;
	}
	const cleanName = filenameMatch[1].replace(/[^a-zA-Z0-9._-]/g, "_");
	const bodyOffset = body.indexOf("\r\n\r\n", body.indexOf(partSep)) + 4;
	const nextBoundary = body.indexOf(Buffer.from(`\r\n${partSep}`), bodyOffset);
	return { cleanName, buf: body.subarray(bodyOffset, nextBoundary) };
}

async function readJsonUpload(
	req: Request,
	res: Response<UploadResponse>,
): Promise<{ cleanName: string; buf: Buffer } | null> {
	const bodyBuf = await readBoundedUploadBody(req, res);
	if (!bodyBuf) return null;
	let jsonBody: any;
	try {
		jsonBody = JSON.parse(bodyBuf.toString("utf-8"));
	} catch {
		res.status(400).json({ error: "Invalid JSON" });
		return null;
	}
	if (!jsonBody.filename || !jsonBody.data) {
		res.status(400).json({ error: "filename and data required" });
		return null;
	}
	return {
		cleanName: jsonBody.filename.replace(/[^a-zA-Z0-9._-]/g, "_"),
		buf: Buffer.from(jsonBody.data, "base64"),
	};
}

function validateUploadName(cleanName: string): string | null {
	const ext = extname(cleanName).toLowerCase();
	if (!ALLOWED_IMG_EXTS.has(ext)) return `Extension "${ext}" not allowed`;
	if (RESERVED_NAMES.has(cleanName.toLowerCase())) return "Reserved filename";
	return null;
}
