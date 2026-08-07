/**
 * Standalone Maket viewer — opens a `.maket` bundle entirely in the browser.
 * No WebSocket, no server API: the file is decoded locally (see bundle.ts)
 * and rendered by the same Board/WorkspaceDoc/PageCanvas stack as the editor,
 * with the store in `readOnly` mode.
 */

import { FileUp, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Board } from "../components/Board";
import { DataSourceToolbarControl } from "../components/DataSourceToolbarControl";
import { applyColorScheme } from "../lib/colorScheme";
import { useStore } from "../store/useStore";
import { requestFit } from "../store/zoomBridge";
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

	useEffect(() => {
		applyColorScheme(darkMode);
	}, [darkMode]);

	const openData = useCallback(async (data: ArrayBuffer, name: string) => {
		setBusy(true);
		setError(null);
		try {
			const workspace = await decodeMaketFile(data);
			revokeAssetUrls(currentAssetUrls.current);
			currentAssetUrls.current = workspace.assetUrls;
			hydrateViewerWorkspace(workspace);
			setFileName(name);
			setLoaded(true);
			requestFit();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, []);

	const openFile = useCallback(
		async (file: File) => {
			await openData(await file.arrayBuffer(), file.name);
		},
		[openData],
	);

	useEffect(() => {
		const src = new URLSearchParams(location.search).get("src");
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
	}, [openData]);

	if (!loaded) {
		return <DropZone busy={busy} error={error} onFile={openFile} />;
	}
	return (
		<div className="relative h-full w-full">
			<Board locked={false} />
			<ViewerBar fileName={fileName} onFile={openFile} />
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
}: {
	fileName: string | null;
	onFile: (file: File) => void;
}) {
	const darkMode = useStore((s) => s.darkMode);
	const docCount = useStore((s) => s.workspaceDocNames.length);
	const inputRef = useRef<HTMLInputElement>(null);

	return (
		<div
			data-toolbar-shell
			className="fixed right-2 bottom-2 left-2 z-50 flex items-center justify-center gap-3 rounded-full border border-border bg-panel px-4 py-2 shadow-lg sm:right-auto sm:bottom-4 sm:left-1/2 sm:w-auto sm:-translate-x-1/2"
		>
			<span className="text-sm font-bold text-text-1">Maket Viewer</span>
			{fileName && (
				<span className="max-w-48 truncate text-xs text-text-3">
					{fileName} · {docCount} doc{docCount > 1 ? "s" : ""}
				</span>
			)}
			<DataSourceToolbarControl />
			<button
				type="button"
				title="Open another file"
				aria-label="Open another file"
				onClick={() => inputRef.current?.click()}
				className="flex h-7 w-7 items-center justify-center rounded-full text-text-2 hover:bg-border/50"
			>
				<FileUp size={14} />
			</button>
			<button
				type="button"
				title="Toggle dark mode"
				aria-label="Toggle dark mode"
				onClick={() => useStore.getState().toggleDarkMode()}
				className="flex h-7 w-7 items-center justify-center rounded-full text-text-2 hover:bg-border/50"
			>
				{darkMode ? <Sun size={14} /> : <Moon size={14} />}
			</button>
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
