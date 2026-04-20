/**
 * assets routes — static serving + thumb/preview variants + metadata listing +
 * upload. Background optimization runs after writes via `assets.optimize`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import type { AssetsListResponse, UploadResponse } from "@maket/shared";
import type { Response } from "express";
import express, { Router as createRouter, type Router } from "express";
import type { AssetsService } from "../services/assets.js";
import type { Bus } from "../services/bus.js";
import type { Config } from "../services/config.js";
import type { Store } from "../services/store.js";

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

const RESERVED_NAMES = new Set(["metadata.json", "thumbs"]);

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

	// Image variants — thumb/preview served at reduced resolution.
	// biome-ignore lint/suspicious/noExplicitAny: express req/res are loose
	router.get("/assets/:variant(thumb|preview)/:file", async (req: any, res) => {
		const { variant, file } = req.params as { variant: string; file: string };
		const original = resolve(join(ASSETS_DIR, file));
		if (!original.startsWith(resolve(ASSETS_DIR) + sep))
			return res.status(400).end();
		if (!existsSync(original)) return res.status(404).end();

		const cfg = VARIANTS[variant];
		if (!cfg) return res.status(400).end();
		const cacheDir = join(ASSETS_DIR, cfg.subdir);
		const cached = join(cacheDir, file.replace(/\.[^.]+$/, ".jpg"));

		if (existsSync(cached)) {
			res.setHeader("Content-Type", "image/jpeg");
			res.setHeader("Cache-Control", "public, max-age=86400");
			return res.sendFile(cached);
		}

		try {
			const { Jimp } = await import("jimp");
			const image = await Jimp.read(original);
			if (image.width <= cfg.maxPx && image.height <= cfg.maxPx) {
				res.setHeader("Cache-Control", "public, max-age=86400");
				return res.sendFile(original);
			}
			image.scaleToFit({ w: cfg.maxPx, h: cfg.maxPx });
			const buf = await image.getBuffer("image/jpeg", { quality: cfg.quality });
			if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
			writeFileSync(cached, buf);
			res.setHeader("Content-Type", "image/jpeg");
			res.setHeader("Cache-Control", "public, max-age=86400");
			res.sendFile(cached);
			// biome-ignore lint/suspicious/noExplicitAny: error shape varies
		} catch (err: any) {
			log(`[variant] ${variant}/${file} failed: ${err.message}`);
			res.sendFile(original);
		}
	});

	// maxAge 0 keeps the browser's copy revalidated by ETag on every request,
	// so `maket_image import --overwrite` takes effect without a hard-refresh.
	router.use("/assets", express.static(ASSETS_DIR, { maxAge: 0, etag: true }));

	router.get("/api/assets", (_req, res: Response<AssetsListResponse>) => {
		const files = assets.listFilenames();
		const dbAssets = store.loadAllAssets();
		const images = files.map((f) => {
			const meta = dbAssets.find((a) => a.filename === f);
			return meta ? { file: f, ...meta } : { file: f };
		});
		res.json({ images });
	});

	router.post("/api/upload", async (req, res: Response<UploadResponse>) => {
		try {
			const contentType = req.headers["content-type"] || "";

			let cleanName: string;
			let buf: Buffer;

			if (contentType.includes("multipart/form-data")) {
				const chunks: Buffer[] = [];
				for await (const chunk of req) chunks.push(chunk as Buffer);
				const body = Buffer.concat(chunks);
				const boundary = contentType.split("boundary=")[1];
				if (!boundary)
					return res.status(400).json({ error: "Missing boundary" });

				const partSep = `--${boundary}`;
				const raw = body.toString("latin1");
				const parts = raw
					.split(partSep)
					.filter((p) => p.includes("Content-Disposition"));
				if (parts.length === 0)
					return res.status(400).json({ error: "No file in upload" });

				const part = parts[0];
				if (!part) return res.status(400).json({ error: "No file part" });
				const headerEnd = part.indexOf("\r\n\r\n");
				if (headerEnd === -1)
					return res.status(400).json({ error: "Malformed multipart" });

				const headers = part.slice(0, headerEnd);
				const filenameMatch = headers.match(/filename="([^"]+)"/);
				if (!filenameMatch)
					return res.status(400).json({ error: "No filename in upload" });

				const rawName = filenameMatch[1];
				if (!rawName) return res.status(400).json({ error: "No filename" });
				cleanName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_");
				const bodyOffset = body.indexOf("\r\n\r\n", body.indexOf(partSep)) + 4;
				const nextBoundary = body.indexOf(
					Buffer.from(`\r\n${partSep}`),
					bodyOffset,
				);
				buf = body.subarray(bodyOffset, nextBoundary);
			} else {
				// biome-ignore lint/suspicious/noExplicitAny: JSON payload is loose
				const jsonBody = await new Promise<any>((resolve, reject) => {
					let data = "";
					req.on("data", (chunk: Buffer) => (data += chunk));
					req.on("end", () => {
						try {
							resolve(JSON.parse(data));
						} catch {
							reject(new Error("Invalid JSON"));
						}
					});
				});
				if (!jsonBody.filename || !jsonBody.data)
					return res.status(400).json({ error: "filename and data required" });
				cleanName = jsonBody.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
				buf = Buffer.from(jsonBody.data, "base64");
			}

			const ext = extname(cleanName).toLowerCase();
			if (!ALLOWED_IMG_EXTS.has(ext))
				return res
					.status(400)
					.json({ error: `Extension "${ext}" not allowed` });
			if (RESERVED_NAMES.has(cleanName.toLowerCase()))
				return res.status(400).json({ error: "Reserved filename" });

			const replaced = assets.exists(cleanName);
			await assets.importBuffer(buf, cleanName, true);

			// Add to metadata.json index if present (legacy).
			const metaPath = join(ASSETS_DIR, "metadata.json");
			if (existsSync(metaPath)) {
				const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
				// biome-ignore lint/suspicious/noExplicitAny: metadata.json shape is loose
				if (!meta.images.find((i: any) => i.file === cleanName)) {
					meta.images.push({
						file: cleanName,
						title: cleanName.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
					});
					writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
				}
			}

			setTimeout(() => {
				void assets.optimize(cleanName);
			}, 0);
			bus.emit("assets:changed", {});

			log(
				`${replaced ? "Replaced" : "Uploaded"}: ${cleanName} (${buf.length} bytes)`,
			);
			res.json({ ok: true, file: cleanName, replaced });
			// biome-ignore lint/suspicious/noExplicitAny: error shape varies
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	});

	return router;
}
