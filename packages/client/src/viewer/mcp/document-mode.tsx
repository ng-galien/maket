/**
 * The document mode of the Maket reader in MCP Apps hosts: one document read
 * through the reader surface of the standalone viewer. Pages and images are
 * fetched one by one through the app-only tool `maket_reader` and hydrated
 * like a bundle; a state document is live, its controls write through the
 * same tool as the Maket form writes over the WebSocket.
 */

import type { DocumentStateClientView } from "@maket/shared";
import { BookOpen, ExternalLink, Rows3 } from "lucide-react";
import {
	type MutableRefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	ReaderPageControls,
	ReaderSurface,
	scrollToReadingPage,
	useReadingKeyboard,
} from "../../components/ReadingWorkspace";
import { type TranslationKey, useT } from "../../i18n/useT";
import type { Document } from "../../store/types";
import { useStore } from "../../store/useStore";
import { type StatePatchCommand, setStatePatchTransport } from "../../store/ws";
import { hydrateViewerWorkspace } from "../hydrate";
import type { McpAppBridge } from "./bridge";

export interface DocumentOpening {
	mode: "document";
	document: {
		id: string;
		name: string;
		category: string;
		canvas: {
			format: string;
			orientation: string;
			w: number;
			h: number;
			bg?: string;
			margins?: Document["canvas"]["margins"];
		};
		pageCount: number;
		responsive?: boolean;
		pages: { number: number; name: string }[];
	};
	display: {
		pages: number[];
		layout: "scroll" | "page";
		start: number;
		zoom: "fit-width" | "actual";
	};
	readingPath: string;
	readingUrl: string;
}

/** State of a state document as the reader binds its controls. */
type ReaderState = Omit<DocumentStateClientView, "templates">;

interface LoadedPage {
	html: string;
	charteCss: string;
	images: string[];
	locked: boolean;
}

interface PageAnswer {
	html?: string;
	charteCss?: string;
	images?: string[];
	locked?: boolean;
	state?: ReaderState;
	tooLarge?: boolean;
}

interface WriteAnswer {
	ok?: boolean;
	reason?: "locked" | "stale" | "refused";
	state?: ReaderState | null;
}

const CHARTE_NAME = "maket-reader";
const CSS_PX_PER_MM = 96 / 25.4;

function noticeHtml(message: string): string {
	const escaped = message
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
	return `<p style="margin:48px 32px;font:16px system-ui,sans-serif;color:#475569">${escaped}</p>`;
}

/** One page from the server, or the notice that replaces it. */
async function fetchPage(
	bridge: McpAppBridge,
	docName: string,
	number: number,
	notice: (key: TranslationKey) => string,
): Promise<{ page: LoadedPage; state?: ReaderState }> {
	const answer = await bridge
		.callTool("maket_reader", { action: "page", doc: docName, page: number })
		.then((result) =>
			result.isError
				? undefined
				: (result.structuredContent as PageAnswer | undefined),
		)
		.catch(() => undefined);
	if (!answer || answer.tooLarge || typeof answer.html !== "string") {
		const key = answer?.tooLarge
			? "reader_mcp_page_too_large"
			: "reader_mcp_page_failed";
		return {
			page: {
				html: noticeHtml(notice(key)),
				charteCss: "",
				images: [],
				locked: false,
			},
		};
	}
	return {
		page: {
			html: answer.html,
			charteCss: answer.charteCss ?? "",
			images: answer.images ?? [],
			locked: answer.locked === true,
		},
		state: answer.state,
	};
}

/** One image of a page as a data URL, or null. */
async function fetchImage(
	bridge: McpAppBridge,
	target: { docName: string; page: number; file: string; width: number },
): Promise<string | null> {
	const result = await bridge.callTool("maket_reader", {
		action: "image",
		doc: target.docName,
		page: target.page,
		file: target.file,
		width: target.width,
	});
	const dataUrl = (result.structuredContent as { dataUrl?: string } | undefined)
		?.dataUrl;
	return !result.isError && dataUrl?.startsWith("data:image/") ? dataUrl : null;
}

/** One state write, as the Maket form command asks for it. */
async function writeState(
	bridge: McpAppBridge,
	command: StatePatchCommand,
): Promise<WriteAnswer> {
	const result = await bridge
		.callTool("maket_reader", {
			action: "write",
			doc: command.docName,
			expectedRevision: command.expectedRevision,
			op: command.operation.op,
			path: command.operation.path,
			value: command.operation.value,
		})
		.catch(() => undefined);
	return (result?.structuredContent as WriteAnswer | undefined) ?? {};
}

function writeNoticeKey(answer: WriteAnswer): TranslationKey {
	if (answer.reason === "locked") return "reader_mcp_write_locked";
	if (answer.reason === "stale") return "reader_mcp_write_stale";
	return "reader_mcp_write_refused";
}

/** The document as the reader store holds it: the shown pages, each with
 * its HTML once loaded. */
function readerDocument(
	opening: DocumentOpening,
	numbers: number[],
	content: {
		loaded: Map<number, LoadedPage>;
		charteCss: string;
		state: boolean;
	},
): Document {
	const { document } = opening;
	const locked = [...content.loaded.values()].some((page) => page.locked);
	return {
		id: document.id,
		name: document.name,
		category: document.category,
		dataModel: content.state ? "state" : "static",
		canvas: {
			...document.canvas,
			background: document.canvas.bg ?? "#ffffff",
		} as Document["canvas"],
		pages: numbers.map((number) => ({
			id: `page-${number}`,
			name: document.pages[number - 1]?.name ?? `${number}`,
			elements: [],
			html: content.loaded.get(number)?.html ?? "",
		})),
		activePage: 0,
		meta: {
			...(document.responsive === undefined
				? {}
				: { responsive: document.responsive }),
			...(content.charteCss ? { charte: CHARTE_NAME } : {}),
			...(locked ? { locked: true } : {}),
		},
	};
}

/** Put the document, its charte, its images and its state in the store. */
function hydrateReader(
	doc: Document,
	charteCss: string,
	images: Map<string, string>,
	state: ReaderState | null,
): void {
	hydrateViewerWorkspace({
		version: 2,
		documents: [doc],
		chartes: charteCss ? [{ name: CHARTE_NAME, css: charteCss }] : [],
		collections: [],
		documentStates: {},
		assetUrls: new Map(images),
	});
	if (!state) return;
	useStore.setState((s) => ({
		readOnly: false,
		documentStates: {
			...s.documentStates,
			[doc.name]: { ...state, templates: {} },
		},
		stateCanvasModes: { ...s.stateCanvasModes, [doc.name]: "live" },
	}));
}

/** Settle a write as the Maket form result does, keep the state it
 * answers, and say why when it was refused. */
function settleWrite(
	answer: WriteAnswer,
	command: StatePatchCommand,
	reader: {
		loaded: MutableRefObject<Map<number, LoadedPage>>;
		state: MutableRefObject<ReaderState | null>;
		setNotice: (notice: string | null) => void;
		t: (key: TranslationKey) => string;
	},
): void {
	if (answer.state) reader.state.current = answer.state;
	const notice = answer.ok ? undefined : reader.t(writeNoticeKey(answer));
	useStore.getState().settleStatePatch(command.requestId, notice);
	reader.setNotice(notice ?? null);
	if (answer.reason === "locked")
		for (const page of reader.loaded.current.values()) page.locked = true;
}

interface ReaderContent {
	loaded: MutableRefObject<Map<number, LoadedPage>>;
	images: MutableRefObject<Map<string, string>>;
	state: MutableRefObject<ReaderState | null>;
	version: number;
	bump: () => void;
	loadPage: (number: number) => void;
	refreshPages: () => void;
}

/** Pages and images fetched one call at a time, in the order asked. */
function useReaderContent(
	opening: DocumentOpening,
	bridge: McpAppBridge,
): ReaderContent {
	const t = useT();
	const { document, display } = opening;
	const [version, setVersion] = useState(0);
	const loaded = useRef(new Map<number, LoadedPage>());
	const requested = useRef(new Set<string>());
	const images = useRef(new Map<string, string>());
	const state = useRef<ReaderState | null>(null);
	const queue = useRef<Promise<void>>(Promise.resolve());
	const bump = useCallback(() => setVersion((value) => value + 1), []);
	const enqueue = useCallback((task: () => Promise<void>) => {
		queue.current = queue.current.then(task).catch(() => {});
	}, []);
	const width = useCallback(() => {
		const pagePx = document.canvas.w * CSS_PX_PER_MM;
		const shownPx =
			display.zoom === "actual" ? pagePx : Math.min(window.innerWidth, pagePx);
		return Math.ceil(Math.max(64, shownPx) * (window.devicePixelRatio || 1));
	}, [document.canvas.w, display.zoom]);

	const loadImages = useCallback(
		(page: number, files: string[]) => {
			for (const file of files) {
				if (requested.current.has(`image:${file}`)) continue;
				requested.current.add(`image:${file}`);
				enqueue(async () => {
					const dataUrl = await fetchImage(bridge, {
						docName: document.name,
						page,
						file,
						width: width(),
					});
					if (!dataUrl) return;
					images.current.set(file, dataUrl);
					bump();
				});
			}
		},
		[bridge, bump, document.name, enqueue, width],
	);

	const loadPage = useCallback(
		(number: number) => {
			if (requested.current.has(`page:${number}`)) return;
			requested.current.add(`page:${number}`);
			enqueue(async () => {
				const fetched = await fetchPage(bridge, document.name, number, t);
				if (fetched.state) state.current = fetched.state;
				loaded.current.set(number, fetched.page);
				bump();
				loadImages(number, fetched.page.images);
			});
		},
		[bridge, bump, document.name, enqueue, loadImages, t],
	);

	const refreshPages = useCallback(() => {
		const numbers = [...loaded.current.keys()];
		for (const number of numbers) requested.current.delete(`page:${number}`);
		for (const number of numbers) loadPage(number);
	}, [loadPage]);

	return { loaded, images, state, version, bump, loadPage, refreshPages };
}

/** State writes of the page's controls go to the app-only tool; a refusal
 * says why, and every answer reloads the pages from the server. */
function useStateWrites(
	bridge: McpAppBridge,
	content: ReaderContent,
	setNotice: (notice: string | null) => void,
): void {
	const t = useT();
	const { bump, loaded, refreshPages, state } = content;
	useEffect(() => {
		setStatePatchTransport((command) => {
			void writeState(bridge, command).then((answer) => {
				settleWrite(answer, command, { loaded, state, setNotice, t });
				bump();
				refreshPages();
			});
		});
		return () => setStatePatchTransport(null);
	}, [bridge, bump, loaded, refreshPages, setNotice, state, t]);
}

export function DocumentReader({
	opening,
	bridge,
}: {
	opening: DocumentOpening;
	bridge: McpAppBridge;
}) {
	const { document, display } = opening;
	const shown = display.pages;
	const [layout, setLayout] = useState(display.layout);
	const [current, setCurrent] = useState(display.start);
	const [notice, setNotice] = useState<string | null>(null);
	const content = useReaderContent(opening, bridge);
	useStateWrites(bridge, content, setNotice);
	const { loaded, images, state, version, loadPage } = content;

	const numbers = layout === "page" ? [current] : shown;
	const charteCss =
		[...loaded.current.values()].find((page) => page.charteCss)?.charteCss ??
		"";
	const doc = useMemo(
		() =>
			readerDocument(opening, numbers, {
				loaded: loaded.current,
				charteCss,
				state: state.current !== null,
			}),
		[opening, numbers.join(","), charteCss, version, loaded, state],
	);
	useLayoutEffect(
		() => hydrateReader(doc, charteCss, images.current, state.current),
		[doc, charteCss, images, state],
	);
	useEffect(() => {
		loadPage(current);
		const next = shown[shown.indexOf(current) + 1];
		if (layout === "scroll" && next !== undefined) loadPage(next);
	}, [current, layout, loadPage, shown]);

	const position = Math.max(0, shown.indexOf(current));
	const showPage = useCallback(
		(index: number) => {
			const bounded = Math.max(0, Math.min(shown.length - 1, index));
			const number = shown[bounded];
			if (number === undefined) return;
			setCurrent(number);
			requestAnimationFrame(() =>
				scrollToReadingPage(
					document.name,
					layout === "page" ? 0 : bounded,
					"auto",
				),
			);
		},
		[document.name, layout, shown],
	);
	const handleVisiblePage = useCallback(
		(logicalIndex: number) => {
			const number = shown[logicalIndex];
			if (layout === "scroll" && number !== undefined) setCurrent(number);
		},
		[layout, shown],
	);
	useReadingKeyboard({
		pageCount: shown.length,
		pageIndex: position,
		onPageChange: showPage,
	});
	const openInMaket = useCallback(() => {
		bridge.openLink(opening.readingUrl).catch(() => {});
	}, [bridge, opening.readingUrl]);

	return (
		<div className="relative h-full w-full">
			<ReaderSurface
				key={`${document.name}:${layout}`}
				doc={doc}
				dataSource={doc.dataModel === "state" ? "connected" : "static"}
				barPosition="bottom"
				initialPageIndex={layout === "page" ? 0 : position}
				onVisiblePage={handleVisiblePage}
				onNavigatePage={showPage}
				rememberZoom={false}
				fit={display.zoom === "actual" ? "actual" : "fill"}
				status={
					notice ? <WriteNotice notice={notice} onOpen={openInMaket} /> : null
				}
			/>
			<ReaderBar
				opening={opening}
				current={current}
				layout={layout}
				onPage={(number) => showPage(shown.indexOf(number))}
				onLayout={setLayout}
				onOpen={openInMaket}
			/>
		</div>
	);
}

function WriteNotice({
	notice,
	onOpen,
}: {
	notice: string;
	onOpen: () => void;
}) {
	const t = useT();
	return (
		<div
			role="status"
			data-maket-reader-notice
			className="sticky top-2 z-20 mx-auto mb-2 flex w-fit max-w-[calc(100%-1rem)] items-center gap-2 rounded-full border border-border bg-panel/95 px-3 py-1.5 text-xs font-semibold text-text-2 shadow-sm"
		>
			<span>{notice}</span>
			<button
				type="button"
				onClick={onOpen}
				className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-accent-contrast"
			>
				{t("reader_mcp_open_in_maket")}
			</button>
		</div>
	);
}

const BAR_BUTTON =
	"flex size-9 shrink-0 items-center justify-center rounded-xl text-text-3 hover:bg-input hover:text-text-1";

/** Name, contents list, previous and next, layout switch and the link that
 * opens the document in Maket. */
function ReaderBar({
	opening,
	current,
	layout,
	onPage,
	onLayout,
	onOpen,
}: {
	opening: DocumentOpening;
	current: number;
	layout: "scroll" | "page";
	onPage: (number: number) => void;
	onLayout: (layout: "scroll" | "page") => void;
	onOpen: () => void;
}) {
	const t = useT();
	const { document, display } = opening;
	const shown = display.pages;
	const pageName = (number: number) =>
		document.pages[number - 1]?.name ?? `${number}`;
	const otherLayout = layout === "page" ? "scroll" : "page";
	const layoutLabel = t(
		otherLayout === "scroll"
			? "reader_mcp_layout_scroll"
			: "reader_mcp_layout_page",
	);
	return (
		<div
			data-toolbar-shell
			data-maket-reader-bar
			className="absolute right-2 bottom-2 left-2 z-50 flex h-12 items-center gap-1 rounded-2xl border border-border/80 bg-panel/95 p-1 shadow-[0_12px_32px_rgba(0,0,0,0.14)] backdrop-blur-xl"
		>
			<BookOpen size={14} className="ml-2 shrink-0 text-text-3" />
			<span
				className="min-w-0 flex-1 truncate px-1 text-xs font-semibold text-text-1"
				title={document.name}
			>
				{document.name}
			</span>
			<label className="sr-only" htmlFor="maket-reader-contents">
				{t("reader_mcp_contents")}
			</label>
			<select
				id="maket-reader-contents"
				data-maket-reader-contents
				value={current}
				onChange={(event) => onPage(Number(event.target.value))}
				className="h-9 max-w-[38%] min-w-0 rounded-lg border border-border bg-input px-2 text-xs text-text-1"
			>
				{shown.map((number) => (
					<option key={number} value={number}>
						{number}. {pageName(number)}
					</option>
				))}
			</select>
			<ReaderPageControls
				pageIndex={Math.max(0, shown.indexOf(current))}
				pageTotal={shown.length}
				pageLabel={pageName(current)}
				onPageChange={(index) => {
					const number = shown[index];
					if (number !== undefined) onPage(number);
				}}
			/>
			<button
				type="button"
				data-maket-reader-layout={layout}
				title={layoutLabel}
				aria-label={layoutLabel}
				onClick={() => onLayout(otherLayout)}
				className={BAR_BUTTON}
			>
				<Rows3 size={14} />
			</button>
			<button
				type="button"
				data-maket-reader-open
				title={t("reader_mcp_open_in_maket")}
				aria-label={t("reader_mcp_open_in_maket")}
				onClick={onOpen}
				className={BAR_BUTTON}
			>
				<ExternalLink size={14} />
			</button>
		</div>
	);
}
