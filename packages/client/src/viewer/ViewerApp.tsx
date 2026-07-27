/**
 * Standalone Maket viewer — opens a `.maket` bundle entirely in the browser.
 * No WebSocket, no server API: the file is decoded locally (see bundle.ts)
 * and rendered by the same Board/WorkspaceDoc/PageCanvas stack as the editor,
 * with the store in `readOnly` mode.
 */

import { FileUp, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Board } from "../components/Board";
import { useStore } from "../store/useStore";
import { decodeMaketFile } from "./bundle";
import { hydrateViewerWorkspace } from "./hydrate";

export default function ViewerApp() {
	const [loaded, setLoaded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [fileName, setFileName] = useState<string | null>(null);
	const currentAssetUrls = useRef<Map<string, string> | null>(null);
	const darkMode = useStore((s) => s.darkMode);

	useEffect(() => {
		document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
	}, [darkMode]);

	const openData = useCallback(async (data: ArrayBuffer, name: string) => {
		setBusy(true);
		setError(null);
		try {
			const workspace = await decodeMaketFile(data);
			// Release the previous bundle's blobs before swapping workspaces —
			// "Open another file" would otherwise leak them for the tab's life.
			if (currentAssetUrls.current) {
				for (const url of currentAssetUrls.current.values()) {
					URL.revokeObjectURL(url);
				}
			}
			currentAssetUrls.current = workspace.assetUrls;
			hydrateViewerWorkspace(workspace);
			setFileName(name);
			setLoaded(true);
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

	// Optional ?src=<same-origin url> — lets a static page embed the viewer
	// pointing at a published bundle (demo, starter projects, docs).
	useEffect(() => {
		const src = new URLSearchParams(location.search).get("src");
		if (!src) return;
		(async () => {
			setBusy(true);
			try {
				const res = await fetch(src);
				if (!res.ok) throw new Error(`Could not fetch bundle (${res.status})`);
				await openData(
					await res.arrayBuffer(),
					src.split("/").pop() ?? "bundle.maket",
				);
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
				className={`flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-16 py-14 transition-colors ${
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
		<div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-panel px-4 py-2 shadow-lg">
			<span className="text-sm font-bold text-text-1">Maket Viewer</span>
			{fileName && (
				<span className="max-w-48 truncate text-xs text-text-3">
					{fileName} · {docCount} doc{docCount > 1 ? "s" : ""}
				</span>
			)}
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
