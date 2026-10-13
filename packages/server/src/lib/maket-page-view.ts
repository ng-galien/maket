/**
 * The MCP Apps view `ui://maket/page`: a self-contained HTML5 document (inline
 * style and script, no network of its own) that a host renders in a
 * sandboxed iframe beside a `maket_preview snapshot` result. It speaks the
 * minimal JSON-RPC over postMessage of MCP Apps 2026-01-26: `ui/initialize`,
 * then `ui/notifications/initialized`; it renders the page carried by
 * `ui/notifications/tool-result` (structuredContent.maketPage) read-only in
 * a nested srcdoc iframe sandboxed without any permission, so nothing of
 * the page can run script whatever its HTML, scaled to the host container
 * width; it follows the host theme and reports its size with
 * `ui/notifications/size-changed`.
 */

export const MAKET_PAGE_VIEW_URI = "ui://maket/page";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

/** The hosts a charte may load fonts from: the only origins the view uses. */
export const MAKET_PAGE_VIEW_FONT_HOSTS = [
	"https://fonts.googleapis.com",
	"https://fonts.gstatic.com",
	"https://fonts.bunny.net",
];

/** The page a snapshot result carries for the view. */
export interface MaketPageForView {
	document: string;
	page: number;
	/** Size of the page in CSS pixels. */
	width: number;
	height: number;
	/** The page as a self-contained HTML document, or null when too large. */
	html: string | null;
	/** Whether the images of `html` were downscaled to fit. */
	reduced: boolean;
	readingPath: string;
	/** What the view says about the page. */
	note: string;
}

/** Characters of page HTML a result carries for the view at most. */
export const MAKET_PAGE_VIEW_MAX_HTML = 120_000;

/** The page for the view: its surface HTML with images at 96 dpi; above
 * MAKET_PAGE_VIEW_MAX_HTML characters, with images at 24 dpi; above again,
 * no HTML and a note pointing at the reading path. */
export async function pageForView(source: {
	document: string;
	page: number;
	width: number;
	height: number;
	readingPath: string;
	surface: (dpi: number) => Promise<string>;
}): Promise<MaketPageForView> {
	const { surface, ...page } = source;
	const full = await surface(96);
	if (full.length <= MAKET_PAGE_VIEW_MAX_HTML)
		return { ...page, html: full, reduced: false, note: "" };
	const reduced = await surface(24);
	if (reduced.length <= MAKET_PAGE_VIEW_MAX_HTML)
		return {
			...page,
			html: reduced,
			reduced: true,
			note: "reduced: images downscaled to fit the view",
		};
	return {
		...page,
		html: null,
		reduced: false,
		note: `too large to show here; read it in Maket: ${source.readingPath}`,
	};
}

const STYLE = `:root{color-scheme:light dark;--maket-view-bg:var(--color-background-primary,#ffffff);--maket-view-fg:var(--color-text-primary,#1f2937);--maket-view-muted:var(--color-text-secondary,#64748b)}
:root[data-theme=dark]{--maket-view-bg:var(--color-background-primary,#111827);--maket-view-fg:var(--color-text-primary,#e5e7eb);--maket-view-muted:var(--color-text-secondary,#94a3b8)}
html,body{margin:0;padding:0;background:var(--maket-view-bg);color:var(--maket-view-fg);font-family:var(--font-sans,system-ui,sans-serif)}
#status{font-size:12px;line-height:1.4;color:var(--maket-view-muted);padding:6px 8px}
#frame{position:relative;overflow:hidden}
#page{position:absolute;top:0;left:0;transform-origin:top left;background:#ffffff}
#page iframe{display:block;width:100%;height:100%;border:0;background:#ffffff}`;

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// The view script is one self-contained closure serialized into the view HTML: its callbacks share the closure's state.
/** The view script, run once in the host's iframe. */
function viewScript(): void {
	const pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (reason: unknown) => void }
	>();
	let nextId = 1;
	let pageSize: { width: number; height: number } | null = null;
	let initialized = false;
	const status = document.getElementById("status") as HTMLElement;
	const frame = document.getElementById("frame") as HTMLElement;
	const page = document.getElementById("page") as HTMLElement;
	const send = (message: unknown) => window.parent.postMessage(message, "*");
	const request = (method: string, params: unknown) =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject });
			send({ jsonrpc: "2.0", id, method, params });
		});
	const notify = (method: string, params: unknown) =>
		send({ jsonrpc: "2.0", method, params });
	const reportSize = () =>
		initialized &&
		notify("ui/notifications/size-changed", {
			width: Math.ceil(document.documentElement.scrollWidth),
			height: Math.ceil(document.documentElement.scrollHeight),
		});
	const fit = () => {
		if (!pageSize) return reportSize();
		const available =
			frame.clientWidth || document.documentElement.clientWidth || 1;
		const scale = Math.min(1, available / pageSize.width);
		page.style.width = `${pageSize.width}px`;
		page.style.height = `${pageSize.height}px`;
		page.style.transform = `scale(${scale})`;
		frame.style.height = `${Math.ceil(pageSize.height * scale)}px`;
		reportSize();
	};
	const applyContext = (context: {
		theme?: string;
		styles?: { variables?: Record<string, string | undefined> };
	}) => {
		if (!context) return;
		if (context.theme) {
			document.documentElement.dataset.theme = context.theme;
			document.documentElement.style.colorScheme = context.theme;
		}
		for (const [name, value] of Object.entries(context.styles?.variables ?? {}))
			if (value) document.documentElement.style.setProperty(name, value);
		fit();
	};
	const render = (result: {
		structuredContent?: { maketPage?: MaketPageForView };
	}) => {
		const shown = result?.structuredContent?.maketPage;
		if (!shown) {
			status.textContent = "This result carries no Maket page.";
			return reportSize();
		}
		status.textContent = `${shown.document} — page ${shown.page}${shown.note ? ` · ${shown.note}` : ""}`;
		if (!shown.html) {
			page.replaceChildren();
			pageSize = null;
			frame.style.height = "0px";
			return reportSize();
		}
		const sheet = document.createElement("iframe");
		sheet.setAttribute("sandbox", "");
		sheet.setAttribute("title", `${shown.document} — page ${shown.page}`);
		sheet.setAttribute("referrerpolicy", "no-referrer");
		sheet.srcdoc = shown.html;
		page.replaceChildren(sheet);
		pageSize = { width: shown.width, height: shown.height };
		fit();
	};
	window.addEventListener("message", (event) => {
		const message = event.data;
		if (!message || message.jsonrpc !== "2.0") return;
		if (
			message.id !== undefined &&
			message.method === undefined &&
			pending.has(message.id)
		) {
			const waiter = pending.get(message.id);
			pending.delete(message.id);
			if (message.error) waiter?.reject(message.error);
			else waiter?.resolve(message.result);
			return;
		}
		if (message.method === "ui/notifications/tool-result")
			render(message.params);
		else if (message.method === "ui/notifications/host-context-changed")
			applyContext(message.params);
		else if (
			message.id !== undefined &&
			(message.method === "ui/resource-teardown" || message.method === "ping")
		)
			send({ jsonrpc: "2.0", id: message.id, result: {} });
	});
	window.addEventListener("resize", fit);
	request("ui/initialize", {
		appInfo: { name: "maket-page", version: "1.0.0" },
		appCapabilities: { availableDisplayModes: ["inline"] },
		protocolVersion: "2026-01-26",
	})
		.then((result) =>
			applyContext(
				(result as { hostContext?: Parameters<typeof applyContext>[0] })
					?.hostContext ?? {},
			),
		)
		.catch(() => {})
		.finally(() => {
			notify("ui/notifications/initialized", {});
			initialized = true;
			reportSize();
		});
}

/** The HTML5 document of the view. */
export function maketPageViewHtml(): string {
	return [
		"<!DOCTYPE html>",
		'<html lang="en"><head><meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		"<title>Maket page</title>",
		`<style>${STYLE}</style></head><body>`,
		'<div id="status" role="status">Waiting for the Maket page…</div>',
		'<div id="frame"><div id="page"></div></div>',
		`<script>globalThis.__name ??= (target) => target; (${viewScript.toString()})();</script>`,
		"</body></html>",
	].join("");
}
