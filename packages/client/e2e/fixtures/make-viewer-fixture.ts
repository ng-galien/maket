/**
 * Regenerates `viewer-sample.maket`, the checked-in fixture the viewer e2e
 * spec opens. Uses the server's own encoder so the fixture always matches the
 * real bundle format.
 *
 *   npx tsx packages/client/e2e/fixtures/make-viewer-fixture.ts
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type BundleAsset,
	encodeBundleV2,
} from "../../../server/src/lib/maket-format.js";
import { createDocument } from "../../../server/src/types.js";

// 1×1 red PNG
const RED_PIXEL_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

const charte = {
	name: "smokehouse",
	css: [
		":root {",
		"  --charte-color-bg: #f7f1e6;",
		"  --charte-color-primary: #b3542a;",
		"  --charte-color-text: #2d2118;",
		"}",
	].join("\n"),
};

const poster = createDocument({
	name: "poster",
	category: "poster",
	canvas: { w: 210, h: 297, background: "#ffffff", format: "A4" },
	meta: { charte: "smokehouse" },
	pages: [
		{
			id: "p1",
			name: "Front",
			elements: [],
			html: [
				'<div style="padding:20mm;color:var(--charte-color-text)">',
				'<h1 data-id="e1" data-name="title" style="color:var(--charte-color-primary)">Grand Cru Smoked Salmon</h1>',
				'<img data-id="e2" data-name="logo" src="/assets/logo.png" alt="logo" style="width:30mm"/>',
				"</div>",
			].join(""),
		},
	],
});

const labels = createDocument({
	name: "labels",
	category: "label",
	canvas: { w: 90, h: 50, background: "#ffffff", format: "custom" },
	meta: { charte: "smokehouse" },
	pages: [
		{
			id: "p1",
			name: "Label",
			elements: [],
			collection: { name: "products" },
			html: [
				'<div style="padding:4mm">',
				'<div data-id="e1" data-name="product">{{ name }}</div>',
				'<div data-id="e2" data-name="price">{{ price }}</div>',
				"</div>",
			].join(""),
		},
	],
});

const products = {
	name: "products",
	schema: {
		type: "object",
		properties: { name: { type: "string" }, price: { type: "string" } },
		required: ["name", "price"],
	},
	members: [
		{ id: "m1", position: 1, data: { name: "Salmon Classic", price: "12€" } },
		{ id: "m2", position: 2, data: { name: "Trout Fillet", price: "9€" } },
		{ id: "m3", position: 3, data: { name: "Herring Dill", price: "7€" } },
	],
};

const assets: BundleAsset[] = [{ relPath: "logo.png", bytes: RED_PIXEL_PNG }];

const buf = await encodeBundleV2(
	[poster, labels],
	[charte],
	[products],
	assets,
);
const out = join(
	dirname(fileURLToPath(import.meta.url)),
	"viewer-sample.maket",
);
writeFileSync(out, buf);
console.log(`Wrote ${out} (${buf.length} bytes)`);
