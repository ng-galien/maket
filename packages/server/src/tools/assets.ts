/**
 * assets pack — maket_image (compound).
 *
 * Compound dispatch: list, view, meta, import, delete. The `view` → `meta`
 * pairing is a business-rule invariant: image_meta refuses to write metadata
 * unless the caller provides the `context_token` returned by the matching
 * `view` call — proving the image was actually read before metadata is set.
 *
 * Deps: `store` (metadata rows), `bus` (assets:changed), `assets` (filesystem
 * + image helpers bound to `assetsDir`).
 */

import { basename, extname } from "node:path";
import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler, ToolResult } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import type { AssetsService } from "../services/assets.js";
import { validateAssetToken } from "../services/assets.js";
import type { Bus } from "../services/bus.js";
import type { AssetRow, Store } from "../services/store.js";
import { text } from "./_helpers.js";

export interface AssetsDeps {
	store: Store;
	bus: Bus;
	assets: AssetsService;
}

const ActionSchema = z.enum(["list", "view", "meta", "import", "delete"]);

const MaketImageSchema = z.object({
	action: ActionSchema.describe(
		"Operation to run. See the tool description for the action table.",
	),
	filename: z
		.string()
		.optional()
		.describe(
			"Asset filename. Required for view/meta/delete. For import: destination filename (required in register-mode, derived from url/path otherwise).",
		),
	category: z
		.string()
		.optional()
		.describe(
			"For list: filter to this category. For meta/import: category tag.",
		),
	context_token: z
		.string()
		.optional()
		.describe(
			"For meta (REQUIRED): token returned by the matching view call. Proves the image was read before its metadata is written.",
		),
	title: z.string().optional().describe("For meta/import: human title."),
	description: z.string().optional().describe("For meta/import: long prose."),
	tags: z
		.array(z.string())
		.optional()
		.describe("For meta/import: searchable tags."),
	credit: z
		.string()
		.optional()
		.describe("For meta/import: attribution / photographer credit."),
	orientation: z
		.string()
		.optional()
		.describe("For meta/import: orientation hint (landscape/portrait/square)."),
	url: z
		.string()
		.optional()
		.describe("For import: HTTP(S) URL to download from."),
	path: z
		.string()
		.optional()
		.describe("For import: local filesystem path to copy from."),
	overwrite: z
		.boolean()
		.optional()
		.describe("For import: overwrite an existing file with the same name."),
});

const DESCRIPTION = [
	"When to use: manage the asset library (images). `view` → `meta` is a required two-step: meta refuses any write without the context_token from the latest view call — proof the image was read before metadata is attributed.",
	"",
	"Images live on disk under the assets dir; metadata lives in the store; both move together.",
	"  list   — list assets grouped by category; flags items missing metadata.",
	"  view   — load an asset inline (text + binary image) and return its context_token. MUST be called before meta.",
	"  meta   — write/update metadata; rejects without a current context_token.",
	"  import — copy an asset in via url, path, or register-mode (filename-only for already-present files). Auto-optimises + thumbnails.",
	"  delete — remove the file, thumbnail, and metadata row.",
].join("\n");

export function createMaketImageTool(deps: AssetsDeps): ToolHandler {
	const { store, bus, assets } = deps;
	return {
		metadata: {
			name: "maket_image",
			description: DESCRIPTION,
			schema: MaketImageSchema,
		},
		handler: async (rawArgs) => {
			const args = MaketImageSchema.parse(rawArgs);
			switch (args.action) {
				case "list":
					return runList(args, store, assets);
				case "view":
					return runView(args, store, assets);
				case "meta":
					return runMeta(args, store, bus, assets);
				case "import":
					return runImport(args, store, bus, assets);
				case "delete":
					return runDelete(args, store, bus, assets);
			}
		},
	};
}

type Args = z.infer<typeof MaketImageSchema>;

function runList(args: Args, store: Store, assets: AssetsService): ToolResult {
	const files = assets.listFilenames();
	if (!files.length) return text("No images");
	const rows = store.loadAllAssets();
	const entries = files.map((f) => {
		const meta = rows.find((a: AssetRow) => a.filename === f);
		return { file: f, meta, category: meta?.category || "uncategorized" };
	});
	const filtered = args.category
		? entries.filter((e) => e.category === args.category)
		: entries;
	if (!filtered.length) return text(`No assets in category "${args.category}"`);
	const groups = new Map<string, typeof filtered>();
	for (const e of filtered) {
		let group = groups.get(e.category);
		if (!group) {
			group = [];
			groups.set(e.category, group);
		}
		group.push(e);
	}
	let noMeta = 0;
	const sections: string[] = [];
	for (const [cat, items] of groups) {
		const lines = items.map((e) => {
			if (e.meta?.title) {
				const tagsArr = Array.isArray(e.meta.tags) ? e.meta.tags : [];
				const tags = tagsArr.length ? ` [${tagsArr.join(", ")}]` : "";
				return `  - ${e.file} — ${e.meta.title}${tags}`;
			}
			noMeta++;
			return `  - ${e.file} ⚠ no metadata`;
		});
		sections.push(`═══ ${cat} (${items.length}) ═══\n${lines.join("\n")}`);
	}
	const header = noMeta
		? `Assets (${filtered.length} images, ${noMeta} without metadata):`
		: `Assets (${filtered.length} images):`;
	return text(`${header}\n${sections.join("\n")}`);
}

function runView(args: Args, store: Store, assets: AssetsService): ToolResult {
	if (!args.filename) return text("filename is required for action=view", true);
	if (!assets.exists(args.filename))
		return text(`Asset not found: ${args.filename}`, true);
	const validation = assets.validateImageFile(args.filename);
	if (!validation.valid) {
		return text(
			`Cannot view "${args.filename}": ${validation.reason}. Delete with maket_image delete or re-import a valid file.`,
			true,
		);
	}
	const r = assets.readBase64(args.filename, true);
	if (!r) return text(`Asset not readable: ${args.filename}`, true);
	const entry = store.loadAsset(args.filename);
	const lines: string[] = [`File: ${args.filename}`];
	if (entry) {
		if (entry.title) lines.push(`Title: ${entry.title}`);
		if (entry.description) lines.push(`Description: ${entry.description}`);
		if (entry.width && entry.height)
			lines.push(`Dimensions: ${entry.width}x${entry.height}`);
		if (entry.orientation) lines.push(`Orientation: ${entry.orientation}`);
		if (entry.tags?.length) lines.push(`Tags: ${entry.tags.join(", ")}`);
		if (entry.credit) lines.push(`Credit: ${entry.credit}`);
	} else {
		lines.push("(no metadata — use maket_image meta to add)");
	}
	const token = assets.imageToken(args.filename);
	if (token) lines.push(`context_token: ${token}`);

	// Suggest the follow-up: meta (if data missing) always benefits from the token.
	const suggestion = !entry
		? `maket_image meta filename=${args.filename} context_token=${token} title=... description=...`
		: `maket_image meta filename=${args.filename} context_token=${token} <field=new_value>`;
	const body = token
		? `${lines.join("\n")}\n\nnext:\n  - ${suggestion}`
		: lines.join("\n");

	return {
		content: [
			{ type: "text", text: body },
			{ type: "image", data: r.data, mimeType: r.mime },
		],
	};
}

function runMeta(
	args: Args,
	store: Store,
	bus: Bus,
	assets: AssetsService,
): ToolResult {
	if (!args.filename) return text("filename is required for action=meta", true);
	if (!assets.exists(args.filename))
		return text(`Asset not found: ${args.filename}`, true);

	const currentToken = assets.imageToken(args.filename);
	const check = validateAssetToken(
		args.filename,
		args.context_token,
		currentToken,
	);
	if (!check.valid) return text(check.reason || "Invalid token", true);

	store.saveAsset({
		filename: args.filename,
		title: args.title,
		description: args.description,
		category: args.category,
		tags: args.tags,
		credit: args.credit,
		orientation: args.orientation,
	});
	const fields = [
		"title",
		"description",
		"tags",
		"category",
		"credit",
		"orientation",
	].filter((k) => (args as Record<string, unknown>)[k] !== undefined);
	bus.emit("assets:changed", {});
	return text(`${args.filename} — metadata updated (${fields.join(", ")})`);
}

async function runImport(
	args: Args,
	store: Store,
	bus: Bus,
	assets: AssetsService,
): Promise<ToolResult> {
	const source = args.url || args.path;
	const registerMode = !source && !!args.filename;

	let filename: string;
	if (args.filename) {
		filename = args.filename;
	} else if (source && /^https?:\/\//.test(source)) {
		const urlPath = new URL(source).pathname;
		const urlBase = basename(urlPath) || "imported";
		const ext = extname(urlBase).toLowerCase();
		filename = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"].includes(ext)
			? urlBase
			: `${urlBase}.jpg`;
	} else if (source) {
		filename = basename(source);
	} else {
		return text(
			"Provide url, path, or filename (to register an existing asset)",
			true,
		);
	}
	filename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");

	if (!registerMode && source) {
		try {
			if (/^https?:\/\//.test(source)) {
				await assets.importFromUrl(source, filename, !!args.overwrite);
			} else {
				await assets.importFromLocal(source, filename, !!args.overwrite);
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return text(`Import failed: ${msg}`, true);
		}
	} else if (!assets.exists(filename)) {
		return text(`File not found in assets: ${filename}`, true);
	}

	const validation = assets.validateImageFile(filename);
	if (!validation.valid) {
		if (!registerMode) assets.remove(filename);
		return text(
			`Import rejected: ${validation.reason}. ${registerMode ? "File left in place." : "File discarded."}`,
			true,
		);
	}

	const optimized = await assets.optimize(filename);
	const dims = optimized || assets.getDimensions(filename);
	const dimInfo = dims ? ` (${dims.w}×${dims.h})` : "";

	store.saveAsset({
		filename,
		title: args.title,
		description: args.description,
		category: args.category,
		tags: args.tags,
		credit: args.credit,
		orientation: args.orientation,
		width: dims?.w,
		height: dims?.h,
	});

	const mode = registerMode ? "registered" : args.url ? "downloaded" : "copied";
	const metaInfo = [
		args.title,
		args.category,
		args.tags?.length ? `${args.tags.length} tags` : "",
	]
		.filter(Boolean)
		.join(", ");
	bus.emit("assets:changed", {});
	return text(
		`${filename}${dimInfo} — ${mode}${metaInfo ? ` · ${metaInfo}` : ""}`,
	);
}

function runDelete(
	args: Args,
	store: Store,
	bus: Bus,
	assets: AssetsService,
): ToolResult {
	if (!args.filename)
		return text("filename is required for action=delete", true);
	if (!assets.exists(args.filename))
		return text(`Asset not found: ${args.filename}`, true);
	assets.remove(args.filename);
	store.deleteAsset(args.filename);
	bus.emit("assets:changed", {});
	return text(`Deleted asset "${args.filename}" (file + thumbnail + metadata)`);
}

export const assetsPack: ToolPack = {
	id: "assets",
	name: "Assets (images)",
	requires: ["store", "bus", "assets"],
	declaresTools: ["maket_image"],
	register(container) {
		container.register({
			maketImageTool: asFunction(createMaketImageTool).singleton(),
		});
	},
};
