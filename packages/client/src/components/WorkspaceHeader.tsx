import { BookOpen, Lock, Maximize, Printer, Unlock } from "lucide-react";
import { openReadingView, printFocusedDocument } from "../desktopCommands";
import { useT } from "../i18n/useT";
import type { Document } from "../store/types";
import { useFocusedDoc, useStore } from "../store/useStore";
import { sendLockDoc } from "../store/ws";
import { fitToView } from "../store/zoomBridge";
import { CollectionDockButton } from "./CollectionDataControls";
import { ReaderDocumentPicker } from "./ReadingWorkspace";
import { StateDockButton } from "./StateDataControls";

/** Stable document toolbar composed from the existing commands. */
// This shell adapter intentionally composes document controls owned by existing modules.
// code-moniker: ignore[smell-feature-envy-local]
export function WorkspaceHeader({
	onDocumentLock = sendLockDoc,
}: {
	onDocumentLock?: (name: string, locked: boolean) => void;
} = {}) {
	const t = useT();
	const connected = useStore((state) => state.connected);
	const focusedDoc = useFocusedDoc();
	const docs = useStore((state) => state.docs);
	const workspaceDocNames = useStore((state) => state.workspaceDocNames);
	const setFocusedDoc = useStore((state) => state.setFocusedDoc);
	const closeWorkspaceDocuments = useStore(
		(state) => state.closeWorkspaceDocuments,
	);
	const setLibraryView = useStore((state) => state.setLibraryView);
	const settingsOpen = useStore((state) => state.settingsOpen);
	const macDesktop = window.maketDesktop?.platform === "darwin";
	const openDocumentNames = workspaceDocNames.filter((name) => docs.has(name));
	const openDocuments = openDocumentNames.flatMap((name) => {
		const doc = docs.get(name);
		return doc ? [{ name: doc.name, category: doc.category }] : [];
	});
	const headerClassName = `flex h-13 min-w-0 shrink-0 items-center gap-2 border-b border-border bg-panel pr-2.5 ${
		macDesktop ? "pl-[86px]" : "pl-2.5"
	}`;

	if (settingsOpen) {
		return (
			<header
				data-workspace-header
				data-settings-header
				data-toolbar-shell
				data-window-drag={window.maketDesktop ? "true" : undefined}
				className={headerClassName}
			>
				<span
					role="status"
					aria-label={
						connected ? t("maket_connected") : t("maket_disconnected")
					}
					className={`h-2 w-2 shrink-0 rounded-full ${
						connected ? "bg-accent" : "bg-danger animate-pulse"
					}`}
				/>
				<span className="text-base font-semibold text-text-1">
					{t("settings")}
				</span>
			</header>
		);
	}

	return (
		<header
			data-workspace-header
			data-toolbar-shell
			data-window-drag={window.maketDesktop ? "true" : undefined}
			className={headerClassName}
		>
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<span
					role="status"
					aria-label={
						connected ? t("maket_connected") : t("maket_disconnected")
					}
					className={`h-2 w-2 shrink-0 rounded-full ${
						connected ? "bg-accent" : "bg-danger animate-pulse"
					}`}
				/>
				<div
					data-document-context
					className="flex min-w-0 flex-1 items-center gap-2"
				>
					{focusedDoc && <DocumentBreadcrumb category={focusedDoc.category} />}
					{focusedDoc && (
						<span aria-hidden="true" className="shrink-0 text-text-3/70">
							/
						</span>
					)}
					{focusedDoc ? (
						<ReaderDocumentPicker
							documents={openDocuments}
							docName={focusedDoc.name}
							position="top"
							onDocumentChange={setFocusedDoc}
							onCloseDocument={(name) => closeWorkspaceDocuments([name])}
							onCloseAll={() => closeWorkspaceDocuments(openDocumentNames)}
							variant="header"
							className="min-w-0 max-w-[min(32vw,28rem)] shrink"
							title={t("reader_document")}
						/>
					) : (
						<button
							type="button"
							onClick={() => setLibraryView("docs")}
							className="truncate text-base font-semibold text-accent underline-offset-4 hover:underline"
						>
							{t("open_document")}
						</button>
					)}
					<CollectionDockButton />
					<StateDockButton />
				</div>
			</div>

			{focusedDoc && (
				<div className="flex shrink-0 items-center gap-0.5 overflow-x-auto">
					<ReadingButton doc={focusedDoc} />
					<FitButton />
					<DocumentLockButton doc={focusedDoc} onToggle={onDocumentLock} />
					<PrintLink href={printHrefForDoc(focusedDoc)} label={t("print")} />
				</div>
			)}
		</header>
	);
}

function DocumentBreadcrumb({ category }: { category: string }) {
	const t = useT();
	const filterByCategory = useStore((state) => state.filterDocumentsByCategory);
	const categorySegments = category.split("/").filter(Boolean);
	const crumbs = [
		{ segment: "Maket", path: "" },
		...categorySegments.map((segment, index) => ({
			segment,
			path: categorySegments.slice(0, index + 1).join("/"),
		})),
	];
	const label = crumbs.map((crumb) => crumb.segment).join(" / ");
	return (
		<nav
			aria-label={t("document_location")}
			title={label}
			className="flex min-w-0 shrink items-center gap-1.5 overflow-hidden text-md font-medium text-text-2"
		>
			{crumbs.map(({ segment, path }, index) => (
				<span key={path || "maket"} className="contents">
					{index > 0 && (
						<span aria-hidden="true" className="shrink-0 text-text-3/70">
							/
						</span>
					)}
					<button
						type="button"
						onClick={() => filterByCategory(path)}
						aria-label={
							path
								? t("filter_documents_by_category", { category: path })
								: t("clear_document_category_filters")
						}
						className="min-w-0 truncate rounded-sm transition-colors duration-100 hover:text-text-1 hover:underline hover:underline-offset-2"
					>
						{segment}
					</button>
				</span>
			))}
		</nav>
	);
}

function ReadingButton({ doc }: { doc: Document }) {
	const t = useT();
	return (
		<button
			type="button"
			onClick={openReadingView}
			title={t("reading_view")}
			aria-label={t("reading_view")}
			data-doc-name={doc.name}
			className="flex h-8 w-8 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-input hover:text-text-1"
		>
			<BookOpen size={16} />
		</button>
	);
}

function FitButton() {
	const t = useT();
	return (
		<button
			type="button"
			onClick={fitToView}
			title={t("fit")}
			aria-label={t("fit")}
			className="flex h-8 w-8 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-input hover:text-text-1"
		>
			<Maximize size={16} />
		</button>
	);
}

function DocumentLockButton({
	doc,
	onToggle,
}: {
	doc: Document;
	onToggle: (name: string, locked: boolean) => void;
}) {
	const t = useT();
	const locked = doc.meta?.locked === true;
	const label = locked ? t("doc_unlock") : t("doc_lock");
	return (
		<button
			type="button"
			onClick={() => onToggle(doc.name, !locked)}
			title={label}
			aria-label={label}
			aria-pressed={locked}
			className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
				locked
					? "bg-accent-soft text-accent"
					: "text-text-2 hover:bg-input hover:text-text-1"
			}`}
		>
			{locked ? <Unlock size={16} /> : <Lock size={16} />}
		</button>
	);
}

function PrintLink({ href, label }: { href: string; label: string }) {
	if (window.maketDesktop) {
		return (
			<button
				type="button"
				onClick={() => void printFocusedDocument()}
				title={label}
				aria-label={label}
				className="flex h-8 w-8 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-input hover:text-text-1"
			>
				<Printer size={16} />
			</button>
		);
	}
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener"
			title={label}
			aria-label={label}
			className="flex h-8 w-8 items-center justify-center rounded-md text-text-2 no-underline transition-colors hover:bg-input hover:text-text-1"
		>
			<Printer size={16} />
		</a>
	);
}

/** The server owns page↔collection cursors and `/print` follows them. */
export function printHrefForDoc(doc: Document): string {
	return `/print?${new URLSearchParams({ name: doc.name }).toString()}`;
}
