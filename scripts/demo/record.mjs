#!/usr/bin/env node
/**
 * Live-compose the Maket decks on the running server so a screen recorder can
 * capture the progressive build. Deletes any prior copy, creates each deck
 * from scratch, adds pages one at a time with dwell between each step so the
 * viewport auto-fits and the reader can follow.
 *
 * Usage:
 *   node scripts/demo/record.mjs [--port 24842] [--dwell 3] [--step 1.5]
 *                                [--only en|fr]
 *
 * Options:
 *   --port   HTTP port of the Maket server (default 24843 — the dev server).
 *   --dwell  Seconds to rest on each finished page (default 5).
 *   --step   Seconds between sub-steps inside a page build (default 2.5).
 *   --only   Record only one deck id: "en" or "fr" (default: both).
 *
 * The script assumes:
 *   - Server is already running (npm run dev / npm run dev:watch).
 *   - Charte "maket-brand" is in the store.
 *   - Fractal assets (fractal-branches/triangle/circles/squares.svg) are imported.
 *   - At least one other doc exists so delete-last-doc protection doesn't bite.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parseArgs } from "node:util";
import { decks } from "./decks.mjs";

const { values } = parseArgs({
	options: {
		port: { type: "string", default: "24843" },
		dwell: { type: "string", default: "5" },
		step: { type: "string", default: "2.5" },
		only: { type: "string" },
		"keep-smoke": { type: "boolean", default: false },
		"keep-sentinel": { type: "string", default: "keep-me" },
	},
});

const port = Number(values.port);
const dwellMs = Number(values.dwell) * 1000;
const stepMs = Number(values.step) * 1000;
const only = values.only?.toLowerCase();
const keepSmoke = values["keep-smoke"];
const sentinel = values["keep-sentinel"];

const selected = only ? decks.filter((d) => d.id === only) : decks;

if (selected.length === 0) {
	console.error(
		`no deck matched --only=${only}. Known ids: ${decks.map((d) => d.id).join(", ")}`,
	);
	process.exit(1);
}

const url = new URL(`http://127.0.0.1:${port}/mcp`);
const client = new Client(
	{ name: "maket-demo-recorder", version: "1.0.0" },
	{ capabilities: {} },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(name, args) {
	const res = await client.callTool({ name, arguments: args });
	if (res.isError) {
		const text = res.content?.[0]?.text ?? "(no text)";
		throw new Error(`${name} failed: ${text}`);
	}
	return res;
}

async function ensureDeleted(docName) {
	try {
		await call("maket_doc", { action: "delete", doc: docName });
		console.log(`  cleaned old "${docName}"`);
	} catch (e) {
		if (!/not found/i.test(e.message)) console.log(`  (skip delete: ${e.message})`);
	}
}

/**
 * Clean the workspace to a known-good state before recording: keep the
 * sentinel doc (needed because maket_doc refuses to delete the last doc),
 * optionally keep `_smoke-*` fixtures, delete everything else.
 */
async function cleanWorkspace() {
	const res = await call("maket_doc", { action: "list" });
	const text = res.content?.[0]?.text ?? "";
	const names = [];
	// Names may themselves contain parens (e.g. "foo (imported)"), so anchor on
	// the canvas-info block: "(<format> <orientation>, <N> el.)"
	const LINE_RE =
		/^\s*-\s+(.+?)\s+\((?:A[0-9]|DESKTOP|TABLET|MOBILE)\s+(?:portrait|landscape),\s*\d+\s*el\.\)/;
	for (const line of text.split("\n")) {
		const m = line.match(LINE_RE);
		if (m) names.push(m[1]);
	}
	// Protect decks we're NOT rebuilding right now (if --only is set).
	const preservedDecks = new Set(
		decks.filter((d) => !selected.includes(d)).map((d) => d.name),
	);
	const doomed = names.filter((n) => {
		if (n === sentinel) return false;
		if (preservedDecks.has(n)) return false;
		if (keepSmoke && n.startsWith("_smoke")) return false;
		return true;
	});
	if (doomed.length === 0) {
		console.log("workspace already clean");
		return;
	}
	console.log(`\n━ cleanup (${doomed.length} doc(s))`);
	for (const n of doomed) await ensureDeleted(n);
}

async function viewCharte(name) {
	const res = await call("maket_charte", { action: "view", name });
	const txt = res.content?.[0]?.text ?? "";
	const m = txt.match(/context_token:\s*(\w+)/);
	if (!m) throw new Error(`no context_token from charte "${name}"`);
	return m[1];
}

async function recordDeck(deck) {
	console.log(`\n━ ${deck.name} · ${deck.format} ${deck.orientation}`);
	await ensureDeleted(deck.name);

	const token = await viewCharte(deck.charte);
	console.log(`  charte: ${deck.charte} (${token})`);

	await call("maket_doc", {
		action: "new",
		doc: deck.name,
		format: deck.format,
		orientation: deck.orientation,
		charte: deck.charte,
		category: deck.category,
	});
	await sleep(stepMs);

	await call("maket_workspace", {
		action: "focus",
		doc: deck.name,
		page: 1,
	});
	await sleep(stepMs);

	// A visible "blank page" placeholder the audience sees *before* the real
	// composition — solid charte-bg, no content, so the set call is a clear
	// before/after beat on camera.
	const BLANK = `<div data-id="page" style="width:${deck.orientation === "landscape" ? "297mm;height:210mm" : "210mm;height:297mm"};background:var(--charte-color-bg);"></div>`;

	for (let i = 0; i < deck.pages.length; i++) {
		const page = deck.pages[i];
		const pageNum = i + 1;
		console.log(`  · page ${pageNum}: ${page.name}`);

		if (i !== 0) {
			// Add the page blank, focus it so the viewport fits the empty canvas,
			// dwell, then set the real content.
			await call("maket_page", {
				action: "add",
				doc: deck.name,
				name: page.name,
				html: BLANK,
			});
			await call("maket_workspace", {
				action: "focus",
				doc: deck.name,
				page: pageNum,
			});
			await sleep(stepMs);
		}

		// Set the real HTML — audience sees the page fill in.
		await call("maket_html", {
			action: "set",
			doc: deck.name,
			page: pageNum,
			context_token: token,
			html: page.html,
		});
		await sleep(stepMs);

		if (page.mermaid) {
			await call("maket_mermaid", {
				doc: deck.name,
				page: pageNum,
				targetId: page.mermaid.targetId,
				dataId: page.mermaid.dataId,
				width: page.mermaid.width,
				height: page.mermaid.height,
				bg: page.mermaid.bg,
				fg: page.mermaid.fg,
				accent: page.mermaid.accent,
				line: page.mermaid.line,
				code: page.mermaid.code,
			});
			await sleep(stepMs);
		}

		await sleep(dwellMs);
	}

	// Zoom out to show the whole deck at the end of the run.
	await call("maket_workspace", { action: "fit_view" });
	await sleep(dwellMs);
}

async function main() {
	const transport = new StreamableHTTPClientTransport(url);
	await client.connect(transport);
	console.log(`connected → ${url.href}`);
	console.log(`dwell=${dwellMs}ms · step=${stepMs}ms · decks=${selected.length}`);

	await cleanWorkspace();

	for (const deck of selected) {
		await recordDeck(deck);
	}

	await client.close();
	console.log("\ndone");
}

main().catch((e) => {
	console.error("\nFATAL:", e?.message || e);
	process.exit(1);
});
