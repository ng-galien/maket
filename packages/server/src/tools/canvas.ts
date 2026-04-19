/**
 * canvas pack — maket_canvas (single action: setup).
 *
 * The canvas is the document's physical frame: format, orientation, size in
 * mm, background. Pages live inside it. The other former members of this
 * pack have moved: get_state → maket_doc.state; open_preview + snapshot →
 * maket_preview.
 *
 * Deps: `documents` (lookup + persist), `bus` (canvas:changed).
 */

import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import type { Bus } from "../services/bus.js";
import type { Documents } from "../services/documents.js";
import { computeCanvasDims } from "../types.js";
import { text } from "./_helpers.js";

export interface CanvasDeps {
	documents: Documents;
	bus: Bus;
}

const FormatSchema = z.enum([
	"A2",
	"A3",
	"A4",
	"A5",
	"A6",
	"A7",
	"A8",
	"DESKTOP",
	"TABLET",
	"MOBILE",
]);

const MaketCanvasSchema = z.object({
	doc: z.string().describe("Document name."),
	format: FormatSchema.optional().describe(
		"Paper (A2–A8, mm) or screen (DESKTOP/TABLET/MOBILE, mm-equivalent). Unspecified keeps the current value.",
	),
	orientation: z
		.enum(["portrait", "landscape"])
		.optional()
		.describe("Page orientation. Unspecified keeps the current value."),
	background: z
		.string()
		.optional()
		.describe(
			"CSS background colour. Unspecified keeps the current value. Prefer var(--charte-color-bg) when a charte is loaded.",
		),
	textMargin: z
		.number()
		.optional()
		.describe("Textual margin in mm. Unspecified keeps the current value."),
});

const DESCRIPTION = [
	"When to use: set or update the canvas (physical frame) of a document — format, orientation, background, margins. Call this before adding content to a fresh doc, or when switching a doc between formats.",
	"",
	"Coordinates are in mm.",
	"  Paper sizes — A2=420×594, A3=297×420, A4=210×297, A5=148×210, A6=105×148, A7=74×105, A8=52×74.",
	"  Screen sizes — DESKTOP=288×205 (1440×1024), TABLET=167×239 (834×1194), MOBILE=79×170 (393×852).",
	"Unspecified fields keep their current value.",
].join("\n");

export function createMaketCanvasTool(deps: CanvasDeps): ToolHandler {
	const { documents, bus } = deps;
	return {
		metadata: {
			name: "maket_canvas",
			description: DESCRIPTION,
			schema: MaketCanvasSchema,
		},
		handler: async (rawArgs) => {
			const args = MaketCanvasSchema.parse(rawArgs);
			const d = documents.resolve(args.doc);
			if (!d) return text(`Document "${args.doc}" not found`, true);
			const fmt = args.format || d.canvas.format;
			const orient = args.orientation || d.canvas.orientation || "portrait";
			const { w, h } = computeCanvasDims(fmt, orient);
			d.canvas = {
				format: fmt,
				orientation: orient,
				w,
				h,
				bg: args.background || d.canvas.bg,
				textMargin: args.textMargin ?? d.canvas.textMargin,
			};
			bus.emit("canvas:changed", { docName: d.name });
			const tm = d.canvas.textMargin
				? `  textMargin:${d.canvas.textMargin}mm`
				: "";
			return text(
				`Canvas: ${fmt} ${orient} (${w}x${h}mm) bg=${d.canvas.bg}${tm}`,
			);
		},
	};
}

export const canvasPack: ToolPack = {
	id: "canvas",
	name: "Canvas",
	requires: ["documents", "bus"],
	register(container) {
		container.register({
			maketCanvasTool: asFunction(createMaketCanvasTool).singleton(),
		});
	},
};
