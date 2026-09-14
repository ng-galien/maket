import { BookOpen, Lock, Maximize, Unlock } from "lucide-react";
import { openReadingView } from "../desktopCommands";
import { useT } from "../i18n/useT";
import type { Document } from "../store/types";
import { useFocusedDoc, useStore } from "../store/useStore";
import { sendLockDoc } from "../store/ws";
import { fitToView } from "../store/zoomBridge";
import { CollectionDockButton } from "./CollectionDataControls";
import { DocumentOutputButtons } from "./DocumentOutputControls";
import { ReaderDocumentPicker } from "./ReadingWorkspace";
import { StateDockButton } from "./StateDataControls";
import { WORKSPACE_ICON_BUTTON_CLASS } from "./shared/toolbarButtonStyles";

/** Stable document toolbar composed from the existing commands. */
// This shell adapter intentionally composes document controls owned by existing modules.
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
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
	const closeSettings = useStore((state) => state.closeSettings);
	const macDesktop = window.maketDesktop?.platform === "darwin";
	const openDocumentNames = workspaceDocNames.filter((name) => docs.has(name));
	const openDocuments = openDocumentNames.flatMap((name) => {
		const doc = docs.get(name);
		return doc ? [{ name: doc.name, category: doc.category }] : [];
	});
	const headerClassName = `flex h-14 min-w-0 shrink-0 items-center gap-2.5 border-b border-border bg-panel pr-3 ${
		macDesktop ? "pl-[86px]" : "pl-3"
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
				<nav
					aria-label={t("document_location")}
					title={`Maket / ${t("settings")}`}
					className="flex min-w-0 items-center gap-1.5 text-base font-medium text-text-2"
				>
					<MaketBrandButton
						onClick={closeSettings}
						ariaLabel={t("close_settings")}
					/>
					<span aria-hidden="true" className="text-text-3/70">
						/
					</span>
					<span className="text-base font-semibold text-text-1">
						{t("settings")}
					</span>
				</nav>
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
					<DocumentBreadcrumb category={focusedDoc?.category} />
					<span aria-hidden="true" className="shrink-0 text-text-3/70">
						/
					</span>
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
					<DocumentOutputButtons docName={focusedDoc.name} />
				</div>
			)}
		</header>
	);
}

function DocumentBreadcrumb({ category }: { category?: string }) {
	const t = useT();
	const filterByCategory = useStore((state) => state.filterDocumentsByCategory);
	const categorySegments = category?.split("/").filter(Boolean) ?? [];
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
			className="flex min-w-0 shrink items-center gap-1.5 overflow-hidden text-base font-medium text-text-2"
		>
			{crumbs.map(({ segment, path }, index) => (
				<span key={path || "maket"} className="contents">
					{index > 0 && (
						<span aria-hidden="true" className="shrink-0 text-text-3/70">
							/
						</span>
					)}
					{index === 0 ? (
						<MaketBrandButton
							onClick={() => filterByCategory(path)}
							ariaLabel={t("clear_document_category_filters")}
						/>
					) : (
						<button
							type="button"
							onClick={() => filterByCategory(path)}
							aria-label={t("filter_documents_by_category", {
								category: path,
							})}
							className="min-w-0 truncate rounded-sm transition-colors duration-100 hover:text-text-1 hover:underline hover:underline-offset-2"
						>
							{segment}
						</button>
					)}
				</span>
			))}
		</nav>
	);
}

function MaketBrandButton({
	onClick,
	ariaLabel,
}: {
	onClick: () => void;
	ariaLabel: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title="Maket"
			aria-label={ariaLabel}
			className="shrink-0 rounded-sm opacity-90 transition-opacity duration-100 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
		>
			<img
				src="/favicon.svg?v=4"
				alt=""
				aria-hidden="true"
				data-maket-brand-mark
				className="h-5 w-5 rounded-[3px]"
			/>
		</button>
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
			className={WORKSPACE_ICON_BUTTON_CLASS}
		>
			<BookOpen size={19} strokeWidth={1.8} />
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
			className={WORKSPACE_ICON_BUTTON_CLASS}
		>
			<Maximize size={19} strokeWidth={1.8} />
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
			className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
				locked
					? "bg-accent-soft text-accent"
					: "text-text-2 hover:bg-input hover:text-text-1"
			}`}
		>
			{locked ? (
				<Unlock size={19} strokeWidth={1.8} />
			) : (
				<Lock size={19} strokeWidth={1.8} />
			)}
		</button>
	);
}
