import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { sendLoadDoc } from "../store/ws";
import { ReaderSurface, scrollToReadingPage } from "./ReadingWorkspace";

/** A document-only entry point for a caller such as the TRUST mobile extension. */
// This view is the client composition boundary between the linked route, Zustand and the existing reader.
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
export function LinkedDocumentView({ documentId }: { documentId: string }) {
	const t = useT();
	const connected = useStore((state) => state.connected);
	const ready = useStore((state) => state.settingsHydrated);
	const docList = useStore((state) => state.docList);
	const docs = useStore((state) => state.docs);
	const requested = useRef<string | null>(null);
	const [pageIndex, setPageIndex] = useState(0);
	const [timedOut, setTimedOut] = useState(false);
	const summary = docList.find((entry) => entry.id === documentId);
	const doc = [...docs.values()].find((entry) => entry.id === documentId);

	useEffect(() => {
		const previous = useStore.getState().readOnly;
		useStore.setState({ readOnly: true });
		return () => useStore.setState({ readOnly: previous });
	}, []);

	useEffect(() => {
		if (!connected) {
			requested.current = null;
			return;
		}
		if (!ready || !summary || requested.current === summary.id) return;
		const params = new URLSearchParams(window.location.search);
		const workspaceId = params.get("workspace");
		const collectionId = params.get("collection");
		const owner = workspaceId
			? { workspaceId, ...(collectionId ? { collectionId } : {}) }
			: undefined;
		if (sendLoadDoc(summary.name, owner)) requested.current = summary.id;
	}, [connected, ready, summary]);

	useEffect(() => {
		if (!requested.current || doc) return;
		const timeout = window.setTimeout(() => setTimedOut(true), 10_000);
		return () => window.clearTimeout(timeout);
	}, [doc, summary]);

	if (ready && !summary && !doc) {
		return (
			<div className="grid h-full place-items-center px-6 text-center text-text-2">
				{t("linked_document_not_found")}
			</div>
		);
	}
	if (timedOut && !doc) {
		return (
			<div className="grid h-full place-items-center px-6 text-center text-text-2">
				{t("linked_document_unavailable")}
			</div>
		);
	}
	if (!doc) {
		return (
			<div className="grid h-full place-items-center text-text-2" role="status">
				{t("loading")}
			</div>
		);
	}
	const showPage = (next: number) => {
		const index = Math.max(0, Math.min(doc.pages.length - 1, next));
		setPageIndex(index);
		scrollToReadingPage(doc.name, index);
	};
	return (
		<div data-linked-document={doc.id} className="relative h-full w-full">
			<header className="fixed inset-x-0 top-0 z-[var(--z-bar)] flex min-h-14 items-center gap-3 border-b border-border bg-panel/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-lg">
				<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-text-1">
					{doc.name}
				</h1>
				{doc.pages.length > 1 && (
					<div className="flex shrink-0 items-center gap-1 text-sm text-text-2">
						<button
							type="button"
							aria-label={t("previous_page")}
							disabled={pageIndex === 0}
							onClick={() => showPage(pageIndex - 1)}
							className="grid h-10 w-10 place-items-center rounded-md disabled:opacity-40"
						>
							<ChevronLeft size={19} />
						</button>
						<span
							aria-live="polite"
							className="min-w-12 text-center tabular-nums"
						>
							{pageIndex + 1}/{doc.pages.length}
						</span>
						<button
							type="button"
							aria-label={t("next_page")}
							disabled={pageIndex >= doc.pages.length - 1}
							onClick={() => showPage(pageIndex + 1)}
							className="grid h-10 w-10 place-items-center rounded-md disabled:opacity-40"
						>
							<ChevronRight size={19} />
						</button>
					</div>
				)}
			</header>
			<ReaderSurface
				doc={doc}
				dataSource="connected"
				barPosition="top"
				onVisiblePage={(index) => setPageIndex(index)}
			/>
		</div>
	);
}
