/**
 * preview pack — maket_preview (compound).
 *
 * Compound dispatch:
 *   open     — launch the live-preview URL in the user's default browser.
 *   snapshot — headless-render a page to PNG at its canvas's mm size.
 *
 * Deps: `documents` (page lookup + charte CSS), `config` (PORT + EXPORTS_DIR).
 */

import { writeFileSync } from "node:fs";
import { asFunction } from "awilix";
import puppeteer from "puppeteer";
import { z } from "zod";
import type { ToolHandler, ToolResult } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import {
	CHROMIUM_HEADLESS,
	shouldDisableSandbox,
} from "../lib/chromium-sandbox.js";
import { escapeCssValue, stripStyleClose } from "../lib/css-escape.js";
import { inlineImages } from "../lib/image-inline.js";
import { installNetworkGuard } from "../lib/page-network-guard.js";
import { waitForPageStable } from "../lib/page-stable-wait.js";
import { resolveSafeOutputPath } from "../lib/safe-output-path.js";
import type { AssetsService } from "../services/assets.js";
import type { Config } from "../services/config.js";
import type { DocumentRenderer } from "../services/document-renderer.js";
import type { Documents } from "../services/documents.js";
import { text } from "./_helpers.js";

export interface PreviewDeps {
	documents: Documents;
	config: Config;
	assets: AssetsService;
	documentRenderer?: Pick<DocumentRenderer, "render">;
}

function safeFilename(name: string): string {
	return name.replace(/[/\\:*?"<>|]/g, "_");
}

const ActionSchema = z.enum(["open", "snapshot"]);

const MaketPreviewSchema = z.object({
	action: ActionSchema.describe(
		"Operation to run. See the tool description for the action table.",
	),
	doc: z.string().optional().describe("Document name. Required for snapshot."),
	page: z
		.number()
		.optional()
		.describe("1-based page number. Required for snapshot."),
	path: z
		.string()
		.optional()
		.describe(
			"For snapshot: output PNG path. Defaults to EXPORTS_DIR/<doc>.png.",
		),
});

const DESCRIPTION = [
	"When to use: view documents outside the agent. `open` flips the live preview URL into the user's browser; `snapshot` rasterises a single page to PNG at its true mm size.",
	"",
	"  open     — launch the live preview URL (localhost) in the default browser. No params.",
	"  snapshot — render a page via headless Chromium. Returns the PNG inline (binary) and as a file path on disk.",
].join("\n");

export function createMaketPreviewTool(deps: PreviewDeps): ToolHandler {
	const { documents, config, assets } = deps;
	const documentRenderer = deps.documentRenderer ?? {
		render: (doc: import("../types.js").Document) => doc,
	};
	return {
		metadata: {
			name: "maket_preview",
			description: DESCRIPTION,
			schema: MaketPreviewSchema,
		},
		handler: async (rawArgs) => {
			const args = MaketPreviewSchema.parse(rawArgs);
			if (args.action === "open") return runOpen(config);
			return runSnapshot(args, documents, config, assets, documentRenderer);
		},
	};
}

type Args = z.infer<typeof MaketPreviewSchema>;

async function runOpen(config: Config): Promise<ToolResult> {
	const previewUrl = `http://localhost:${config.PORT}`;
	const { execFile } = await import("node:child_process");
	const { platform } = await import("node:os");
	const cmd =
		platform() === "darwin"
			? "open"
			: platform() === "win32"
				? "start"
				: "xdg-open";
	execFile(cmd, [previewUrl]);
	return text(`Opened ${previewUrl} in browser`);
}

// code-moniker: ignore[smell-feature-envy-local]
// Snapshot is an adapter workflow that coordinates document resolution, preview rendering, filesystem output, and MCP response shaping.
async function runSnapshot(
	args: Args,
	documents: Documents,
	config: Config,
	assets: AssetsService,
	documentRenderer: Pick<DocumentRenderer, "render">,
): Promise<ToolResult> {
	if (!args.doc) return text("doc is required for action=snapshot", true);
	if (args.page == null)
		return text("page is required for action=snapshot", true);
	const d = documents.resolve(args.doc);
	if (!d) return text(`Document "${args.doc}" not found`, true);
	const rendered = documentRenderer.render(d);
	const pageIdx = args.page - 1;
	const page = rendered.pages[pageIdx];
	if (!page)
		return text(`Page ${args.page} not found (${d.pages.length} pages)`, true);
	const html = page.html;
	if (!html)
		return text(
			"No HTML content on current page — use maket_html set first",
			true,
		);

	const { w, h } = rendered.canvas;
	const inlinedHtml = await inlineImages(html, {
		assetsDir: config.ASSETS_DIR,
		pageMm: { w, h },
		dpi: 96,
		mimeFromExt: (p) => assets.mimeFromExt(p),
	});

	const charteCss = documents.charteCss(rendered);
	const safeCharteCss = stripStyleClose(charteCss);
	const safeBg = escapeCssValue(d.canvas.bg || "#ffffff");
	const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  ${safeCharteCss}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { margin: 0; padding: 0; width: ${w}mm; height: ${h}mm; overflow: hidden; background: ${safeBg}; }
  </style></head><body>${inlinedHtml}</body></html>`;

	const scale = 3.78;
	const browser = await puppeteer.launch({
		headless: CHROMIUM_HEADLESS,
		args: shouldDisableSandbox() ? ["--no-sandbox"] : [],
	});
	try {
		const p = await browser.newPage();
		await installNetworkGuard(p, "offline");
		await p.setViewport({
			width: Math.ceil(w * scale),
			height: Math.ceil(h * scale),
		});
		await p.setContent(fullHtml, { waitUntil: "load" });
		await waitForPageStable(p);
		const png = (await p.screenshot({
			type: "png",
			fullPage: false,
		})) as Buffer;
		const b64 = Buffer.from(png).toString("base64");
		const requested = args.path ?? `${safeFilename(d.name)}.png`;
		let outPath: string;
		try {
			outPath = resolveSafeOutputPath(requested, config.EXPORTS_DIR);
		} catch (e) {
			return text((e as Error).message, true);
		}
		writeFileSync(outPath, png);
		return {
			content: [
				{
					type: "text",
					text: `Snapshot saved: ${outPath} (${Math.round(png.length / 1024)} KB)`,
				},
				{ type: "image", data: b64, mimeType: "image/png" },
			],
		};
	} finally {
		await browser.close();
	}
}

export const previewPack: ToolPack = {
	id: "preview",
	name: "Preview",
	requires: ["documents", "config", "assets", "documentRenderer"],
	declaresTools: ["maket_preview"],
	register(container) {
		container.register({
			maketPreviewTool: asFunction(createMaketPreviewTool).singleton(),
		});
	},
};
