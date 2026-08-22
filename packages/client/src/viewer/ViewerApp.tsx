/**
 * Standalone Maket viewer — opens a `.maket` bundle entirely in the browser.
 * No WebSocket, no server API: the file is decoded locally (see bundle.ts)
 * and rendered by the same Board/WorkspaceDoc/PageCanvas stack as the editor,
 * with the store in `readOnly` mode.
 */

import { FileUp, Moon, MoreHorizontal, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	preferredScroll,
	ReaderDocumentPicker,
	ReaderPageControls,
	ReaderSurface,
	readerPageName,
	scrollToReadingPage,
	useReadingKeyboard,
} from "../components/ReadingWorkspace";
import { collectionPageViews } from "../components/WorkspaceDoc";
import { useT } from "../i18n/useT";
import { applyColorScheme } from "../lib/colorScheme";
import type { Document } from "../store/types";
import { useFocusedDoc, useStore } from "../store/useStore";
import { decodeMaketFile } from "./bundle";
import { hydrateViewerWorkspace } from "./hydrate";

function revokeAssetUrls(assetUrls: Map<string, string> | null): void {
	if (!assetUrls) return;
	for (const url of assetUrls.values()) URL.revokeObjectURL(url);
}

async function fetchPublishedBundle(src: string): Promise<{
	data: ArrayBuffer;
	name: string;
}> {
	const url = new URL(src, location.href);
	if (url.origin !== location.origin) {
		throw new Error("Bundle URL must use the same origin as the viewer");
	}
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Could not fetch bundle (${response.status})`);
	}
	return {
		data: await response.arrayBuffer(),
		name: url.pathname.split("/").pop() ?? "bundle.maket",
	};
}

export default function ViewerApp() {
	const [loaded, setLoaded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [fileName, setFileName] = useState<string | null>(null);
	const currentAssetUrls = useRef<Map<string, string> | null>(null);
	const darkMode = useStore((s) => s.darkMode);
	const focusedDoc = useFocusedDoc();
	const options = viewerOptions(location.search);

	useEffect(() => {
		applyColorScheme(darkMode);
	}, [darkMode]);

	const openData = useCallback(
		async (data: ArrayBuffer, name: string) => {
			setBusy(true);
			setError(null);
			try {
				const workspace = await decodeMaketFile(data);
				revokeAssetUrls(currentAssetUrls.current);
				currentAssetUrls.current = workspace.assetUrls;
				hydrateViewerWorkspace(workspace);
				const requestedDocument = options.doc
					? workspace.documents.find(
							(document) =>
								document.id === options.doc || document.name === options.doc,
						)
					: undefined;
				if (requestedDocument) {
					useStore.getState().setFocusedDoc(requestedDocument.name);
				}
				setFileName(name);
				setLoaded(true);
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
			} finally {
				setBusy(false);
			}
		},
		[options.doc],
	);

	const openFile = useCallback(
		async (file: File) => {
			await openData(await file.arrayBuffer(), file.name);
		},
		[openData],
	);

	useEffect(() => {
		const src = options.src;
		if (!src) return;
		(async () => {
			setBusy(true);
			try {
				const bundle = await fetchPublishedBundle(src);
				await openData(bundle.data, bundle.name);
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
				setBusy(false);
			}
		})();
	}, [openData, options.src]);

	if (!loaded) {
		return <DropZone busy={busy} error={error} onFile={openFile} />;
	}
	if (!focusedDoc) return null;
	return (
		<ViewerDocument
			doc={focusedDoc}
			options={options}
			fileName={fileName}
			onFile={openFile}
		/>
	);
}

interface ViewerOptions {
	src: string | null;
	doc: string | null;
	embedded: boolean;
}

export function viewerOptions(search: string): ViewerOptions {
	const params = new URLSearchParams(search);
	return {
		src: params.get("src"),
		doc: params.get("doc"),
		embedded: params.get("embed") === "1",
	};
}

function ViewerDocument({
	doc,
	options,
	fileName,
	onFile,
}: {
	doc: Document;
	options: ViewerOptions;
	fileName: string | null;
	onFile: (file: File) => void;
}) {
	const collections = useStore((state) => state.collections);
	const t = useT();
	const pageViews = useMemo(
		() =>
			collectionPageViews(
				doc,
				collections,
				{},
				{},
				{ page: t("page"), row: t("collection_row_lower") },
				"reader",
			),
		[collections, doc, t],
	);
	const [pageIndex, setPageIndex] = useState(0);
	useEffect(() => setPageIndex(0), [doc.name]);
	const showPage = useCallback(
		(logicalIndex: number, behavior: ScrollBehavior = "smooth") => {
			if (pageViews.length === 0) return;
			const nextIndex = Math.max(
				0,
				Math.min(pageViews.length - 1, logicalIndex),
			);
			setPageIndex(nextIndex);
			requestAnimationFrame(() =>
				scrollToReadingPage(doc.name, nextIndex, preferredScroll(behavior)),
			);
		},
		[doc.name, pageViews.length],
	);
	const handleVisiblePage = useCallback(
		(logicalIndex: number) => setPageIndex(logicalIndex),
		[],
	);
	useReadingKeyboard({
		pageCount: pageViews.length,
		pageIndex,
		onPageChange: showPage,
	});
	const localStateStatus =
		doc.dataModel === "state" ? (
			<div
				role="status"
				className="sticky top-2 z-20 mx-auto mb-2 w-fit rounded-full border border-border bg-panel/95 px-3 py-1.5 text-xs font-semibold text-text-2 shadow-sm"
			>
				{t("reader_local_state")}
			</div>
		) : null;
	return (
		<div className="relative h-full w-full">
			<ReaderSurface
				key={doc.name}
				doc={doc}
				dataSource="static"
				embedded={options.embedded}
				barPosition={options.embedded ? undefined : "bottom"}
				onVisiblePage={handleVisiblePage}
				status={localStateStatus}
			/>
			{!options.embedded && (
				<ViewerBar
					fileName={fileName}
					onFile={onFile}
					pageIndex={pageIndex}
					pageTotal={pageViews.length}
					pageLabel={readerPageName(
						doc,
						pageViews[pageIndex],
						pageIndex,
						t("reader_empty_collection"),
					)}
					onPageChange={showPage}
				/>
			)}
		</div>
	);
}

function DropZone({
	busy,
	error,
	onFile,
}: {
	busy: boolean;
	error: string | null;
	onFile: (file: File) => void;
}) {
	const [dragOver, setDragOver] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	return (
		<div
			className="h-full w-full flex items-center justify-center bg-bg"
			onDragOver={(e) => {
				e.preventDefault();
				setDragOver(true);
			}}
			onDragLeave={() => setDragOver(false)}
			onDrop={(e) => {
				e.preventDefault();
				setDragOver(false);
				const file = e.dataTransfer.files[0];
				if (file) onFile(file);
			}}
		>
			<div
				className={`mx-4 flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-8 py-12 transition-colors sm:px-16 sm:py-14 ${
					dragOver ? "border-accent bg-accent/5" : "border-border bg-panel"
				}`}
			>
				<FileUp size={40} className="text-text-3" />
				<div className="text-center">
					<div className="text-lg font-semibold text-text-1">Maket Viewer</div>
					<div className="mt-1 text-sm text-text-3">
						Drop a <code>.maket</code> file here to open it
					</div>
					<div className="mt-0.5 text-xs text-text-3">
						Everything stays in your browser — nothing is uploaded.
					</div>
				</div>
				<button
					type="button"
					disabled={busy}
					onClick={() => inputRef.current?.click()}
					className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
				>
					{busy ? "Opening…" : "Choose a file"}
				</button>
				{error && (
					<div className="max-w-sm text-center text-xs font-medium text-danger">
						{error}
					</div>
				)}
				<input
					ref={inputRef}
					type="file"
					accept=".maket"
					className="hidden"
					onChange={(e) => {
						const file = e.target.files?.[0];
						if (file) onFile(file);
						e.target.value = "";
					}}
				/>
			</div>
		</div>
	);
}

function ViewerBar({
	fileName,
	onFile,
	pageIndex,
	pageTotal,
	pageLabel,
	onPageChange,
}: {
	fileName: string | null;
	onFile: (file: File) => void;
	pageIndex: number;
	pageTotal: number;
	pageLabel: string;
	onPageChange: (pageIndex: number) => void;
}) {
	const darkMode = useStore((s) => s.darkMode);
	const focusedDocName = useStore((s) => s.focusedDocName);
	const documentNames = useStore((s) => s.workspaceDocNames);
	const docs = useStore((s) => s.docs);
	const setFocusedDoc = useStore((s) => s.setFocusedDoc);
	const inputRef = useRef<HTMLInputElement>(null);
	const documents = documentNames.flatMap((name) => {
		const doc = docs.get(name);
		return doc ? [{ name: doc.name, category: doc.category }] : [];
	});

	return (
		<div
			data-toolbar-shell
			className="fixed right-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-2 z-50 flex h-14 items-center gap-1 rounded-2xl border border-border/80 bg-panel/95 p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.14)] backdrop-blur-xl sm:right-auto sm:left-1/2 sm:w-auto sm:-translate-x-1/2"
		>
			<ReaderDocumentPicker
				documents={documents}
				docName={focusedDocName ?? ""}
				position="bottom"
				onDocumentChange={setFocusedDoc}
				title={fileName ?? undefined}
				className="min-w-0 flex-1 sm:w-[clamp(13rem,28vw,19rem)] sm:flex-none"
			/>
			<div className="mx-1 h-7 w-px shrink-0 bg-border" />
			<ReaderPageControls
				pageIndex={pageIndex}
				pageTotal={pageTotal}
				pageLabel={pageLabel}
				onPageChange={onPageChange}
			/>
			<button
				type="button"
				title="Open another file"
				aria-label="Open another file"
				onClick={() => inputRef.current?.click()}
				className="hidden size-10 items-center justify-center rounded-xl text-text-3 transition-colors hover:bg-input hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:flex"
			>
				<FileUp size={14} />
			</button>
			<button
				type="button"
				title="Toggle dark mode"
				aria-label="Toggle dark mode"
				onClick={() => useStore.getState().toggleDarkMode()}
				className="hidden size-10 items-center justify-center rounded-xl text-text-3 transition-colors hover:bg-input hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:flex"
			>
				{darkMode ? <Sun size={14} /> : <Moon size={14} />}
			</button>
			<ViewerMobileActions
				darkMode={darkMode}
				onOpenFile={() => inputRef.current?.click()}
				onToggleDarkMode={() => useStore.getState().toggleDarkMode()}
			/>
			<input
				ref={inputRef}
				type="file"
				accept=".maket"
				className="hidden"
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) onFile(file);
					e.target.value = "";
				}}
			/>
		</div>
	);
}

function ViewerMobileActions({
	darkMode,
	onOpenFile,
	onToggleDarkMode,
}: {
	darkMode: boolean;
	onOpenFile: () => void;
	onToggleDarkMode: () => void;
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;
		const closeOutside = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setOpen(false);
			triggerRef.current?.focus();
		};
		document.addEventListener("pointerdown", closeOutside);
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("pointerdown", closeOutside);
			window.removeEventListener("keydown", closeOnEscape);
		};
	}, [open]);

	return (
		<div
			ref={rootRef}
			className="relative sm:hidden"
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
			}}
		>
			<button
				ref={triggerRef}
				type="button"
				aria-label="More viewer actions"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
				className="flex size-10 items-center justify-center rounded-xl text-text-3 transition-colors hover:bg-input hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
			>
				<MoreHorizontal size={18} />
			</button>
			{open && (
				<div
					role="group"
					aria-label="Viewer actions"
					data-reader-menu
					className="absolute right-0 bottom-full mb-2 w-52 rounded-xl border border-border bg-panel p-1.5 shadow-[0_18px_56px_rgba(0,0,0,0.2)]"
					style={{ animation: "popoverIn 140ms cubic-bezier(0.16, 1, 0.3, 1)" }}
				>
					<button
						type="button"
						onClick={() => {
							setOpen(false);
							onOpenFile();
						}}
						className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-text-2 outline-none transition-colors hover:bg-input focus-visible:bg-input focus-visible:text-text-1"
					>
						<FileUp size={16} />
						Open another file
					</button>
					<button
						type="button"
						onClick={() => {
							onToggleDarkMode();
							setOpen(false);
						}}
						className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-text-2 outline-none transition-colors hover:bg-input focus-visible:bg-input focus-visible:text-text-1"
					>
						{darkMode ? <Sun size={16} /> : <Moon size={16} />}
						Toggle dark mode
					</button>
				</div>
			)}
		</div>
	);
}
