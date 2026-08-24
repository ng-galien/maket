import type { Collection } from "@maket/shared";
import { Link2, Link2Off, Plus, Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { wsSend } from "../store/ws";
import { HoldToDelete } from "./shared/HoldToDelete";
import { LibraryListDivider } from "./shared/LibraryListDivider";
import { LibrarySearchField } from "./shared/LibrarySearchField";
import {
	LibraryToolbar,
	LibraryToolbarActions,
	LibraryToolbarRow,
} from "./shared/LibraryToolbar";
import { showLibraryScrollActivity } from "./shared/libraryScroll";

// code-moniker: ignore[smell-feature-envy-local]
// code-moniker: ignore[smell-long-callable]
// Collections panel shell: coordinates store-backed library focus with the
// overlay lifecycle so opening an editor also dismisses the blocking panel.
export function CollectionsTab() {
	const t = useT();
	const collections = useStore((s) => s.collections);
	const docList = useStore((s) => s.docList);
	const docs = useStore((s) => s.docs);
	const focusedDocName = useStore((s) => s.focusedDocName);
	const focusedPageIndex = useStore((s) => s.focusedPageIndex);
	const focusedCollectionName = useStore((s) => s.focusedCollectionName);
	const setFocusedCollection = useStore((s) => s.setFocusedCollection);
	const setDataDockMode = useStore((s) => s.setDataDockMode);
	const openWorkspaceDocument = useStore((s) => s.openWorkspaceDocument);
	const [naming, setNaming] = useState(false);
	const [deleting, setDeleting] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const focusedDoc = focusedDocName ? docs.get(focusedDocName) : null;
	const focusedPage = focusedDoc?.pages[focusedPageIndex];
	const focusedPageCollection = focusedPage?.collection?.name ?? null;
	const openCollection = (name: string) => {
		setDataDockMode("expanded");
		setFocusedCollection(name);
	};
	const openCollectionDocument = (collectionName: string, docName: string) => {
		setFocusedCollection(collectionName);
		setDataDockMode("split");
		openWorkspaceDocument(docName);
	};
	const setFocusedPageCollection = (collectionName: string | null) => {
		if (!focusedDoc || !focusedPage) return;
		wsSend(
			collectionName
				? {
						type: "collection_bind_page",
						docName: focusedDoc.name,
						pageIndex: focusedPageIndex,
						collectionName,
					}
				: {
						type: "collection_clear_page",
						docName: focusedDoc.name,
						pageIndex: focusedPageIndex,
					},
		);
		if (collectionName) {
			setFocusedCollection(collectionName);
			setDataDockMode("split");
		}
	};

	const sortedCollections = useMemo(
		() => [...collections].sort((a, b) => a.name.localeCompare(b.name)),
		[collections],
	);
	const documentsByCollection = useMemo(() => {
		const grouped = new Map<string, typeof docList>();
		for (const document of docList) {
			for (const binding of document.collectionBindings) {
				const documents = grouped.get(binding.name) ?? [];
				documents.push(document);
				grouped.set(binding.name, documents);
			}
		}
		for (const documents of grouped.values()) {
			documents.sort((a, b) => a.name.localeCompare(b.name));
		}
		return grouped;
	}, [docList]);
	const filteredCollections = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		if (!query) return sortedCollections;
		return sortedCollections.filter((collection) =>
			[
				collection.name,
				collection.description,
				...Object.keys(collection.schema.properties ?? {}),
				...(documentsByCollection.get(collection.name) ?? []).map(
					(document) => document.name,
				),
			]
				.filter(Boolean)
				.join(" ")
				.toLocaleLowerCase()
				.includes(query),
		);
	}, [documentsByCollection, search, sortedCollections]);

	return (
		<div data-collections-list className="flex h-full min-h-0 flex-col">
			<LibraryToolbar>
				<LibraryToolbarRow>
					<LibrarySearchField
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						onClear={() => setSearch("")}
						placeholder={t("collection_search_hint")}
					/>
					<LibraryToolbarActions>
						<button
							type="button"
							title={t("collection_new")}
							aria-label={t("collection_new")}
							onClick={() => setNaming(true)}
							className="flex h-8 w-8 items-center justify-center rounded-md bg-input text-text-3 transition hover:text-text-1"
						>
							<Plus size={13} />
						</button>
					</LibraryToolbarActions>
				</LibraryToolbarRow>
			</LibraryToolbar>

			{naming && (
				<NewCollectionForm
					existingNames={collections.map((collection) => collection.name)}
					onDone={() => setNaming(false)}
					onCreated={openCollection}
				/>
			)}

			{sortedCollections.length === 0 ? (
				<div className="px-3 py-4 text-sm text-text-3">
					{t("collection_none")}
				</div>
			) : filteredCollections.length === 0 ? (
				<div className="px-3 py-4 text-sm text-text-3">
					{t("collection_no_match")}
				</div>
			) : (
				<div
					data-collections-scroll
					onScroll={showLibraryScrollActivity}
					className="library-scroll-area min-h-0 flex-1 overflow-y-auto"
				>
					{filteredCollections.map((collection, index) => (
						<Fragment key={collection.name}>
							<CollectionRow
								collection={collection}
								documents={documentsByCollection.get(collection.name) ?? []}
								active={focusedCollectionName === collection.name}
								deleting={deleting === collection.name}
								focusedPageBinding={
									focusedDoc && focusedPage
										? focusedPageCollection === collection.name
											? "linked"
											: "available"
										: null
								}
								onOpen={() => openCollection(collection.name)}
								onOpenDocument={(documentName) =>
									openCollectionDocument(collection.name, documentName)
								}
								onToggleFocusedPage={() =>
									setFocusedPageCollection(
										focusedPageCollection === collection.name
											? null
											: collection.name,
									)
								}
								onAskDelete={() => setDeleting(collection.name)}
								onCancelDelete={() => setDeleting(null)}
							/>
							{index < filteredCollections.length - 1 && <LibraryListDivider />}
						</Fragment>
					))}
				</div>
			)}
		</div>
	);
}

interface CollectionRowProps {
	collection: Collection;
	documents: ReturnType<typeof useStore.getState>["docList"];
	active: boolean;
	deleting: boolean;
	focusedPageBinding: "linked" | "available" | null;
	onOpen: () => void;
	onOpenDocument: (name: string) => void;
	onToggleFocusedPage: () => void;
	onAskDelete: () => void;
	onCancelDelete: () => void;
}

function CollectionRow(props: CollectionRowProps) {
	const {
		collection,
		documents,
		active,
		deleting,
		focusedPageBinding,
		onOpen,
		onOpenDocument,
		onToggleFocusedPage,
		onAskDelete,
		onCancelDelete,
	} = props;
	const t = useT();
	const fieldCount = Object.keys(collection.schema.properties ?? {}).length;
	return (
		<div
			data-collection-row={collection.name}
			data-active={active || undefined}
			className={`group/collection relative transition-colors duration-100 ${
				active ? "bg-accent-soft" : "hover:bg-input/70"
			}`}
		>
			{active && (
				<span className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-accent" />
			)}
			<div className="flex min-w-0 items-center">
				<button
					type="button"
					onClick={onOpen}
					aria-current={active ? "true" : undefined}
					className="flex min-w-0 flex-1 items-center px-3 py-2.5 text-left"
				>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-base font-medium text-text-1">
							{collection.name}
						</span>
						<span className="mt-0.5 block truncate text-xs text-text-3">
							{t("collection_summary_counts", {
								fields: fieldCount,
								rows: collection.members.length,
							})}
						</span>
					</span>
				</button>
				{focusedPageBinding && !deleting && (
					<button
						type="button"
						title={
							focusedPageBinding === "linked"
								? t("collection_detach_active_page")
								: t("collection_bind_active_page")
						}
						aria-label={
							focusedPageBinding === "linked"
								? t("collection_detach_active_page")
								: t("collection_bind_active_page")
						}
						onClick={onToggleFocusedPage}
						className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-sm transition-colors ${
							focusedPageBinding === "linked"
								? "text-accent hover:bg-accent-soft"
								: "text-text-3 opacity-0 hover:bg-input hover:text-text-1 focus-visible:opacity-100 group-hover/collection:opacity-100"
						}`}
					>
						{focusedPageBinding === "linked" ? (
							<Link2Off size={13} />
						) : (
							<Link2 size={13} />
						)}
					</button>
				)}
				{!deleting && (
					<button
						type="button"
						title={t("delete")}
						aria-label={t("delete")}
						onClick={onAskDelete}
						className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-3 opacity-0 transition-[color,background-color,opacity] duration-100 hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 group-hover/collection:opacity-100"
					>
						<Trash2 size={13} />
					</button>
				)}
			</div>
			{documents.length > 0 && !deleting && (
				<div className="ml-3 border-l border-border pb-1.5 pl-1 pr-2">
					{documents.map((document) => (
						<button
							key={document.name}
							type="button"
							title={`${document.category} / ${document.name}`}
							aria-label={t("collection_open_document", {
								name: document.name,
							})}
							onClick={() => onOpenDocument(document.name)}
							className="flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left text-sm text-text-2 transition-colors hover:bg-input hover:text-accent"
						>
							<span className="truncate">{document.name}</span>
						</button>
					))}
				</div>
			)}
			{deleting ? (
				<div className="px-3 pb-2.5">
					<HoldToDelete
						label={t("collection_delete_hold", { name: collection.name })}
						onConfirm={() => {
							onCancelDelete();
							wsSend({ type: "collection_delete", name: collection.name });
						}}
						onCancel={onCancelDelete}
					/>
				</div>
			) : null}
		</div>
	);
}

function NewCollectionForm({
	existingNames,
	onDone,
	onCreated,
}: {
	existingNames: string[];
	onDone: () => void;
	onCreated: (name: string) => void;
}) {
	const t = useT();
	const [name, setName] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => inputRef.current?.focus(), []);
	const trimmed = name.trim();
	const valid = trimmed.length > 0 && !existingNames.includes(trimmed);

	const create = () => {
		if (!valid) return;
		wsSend({
			type: "collection_save",
			collection: {
				name: trimmed,
				description: "",
				schema: {
					type: "object",
					properties: {},
					required: [],
					additionalProperties: false,
				},
				members: [],
			},
		});
		onCreated(trimmed);
		onDone();
	};

	return (
		<div className="flex shrink-0 items-center gap-1.5 border-b border-border p-2">
			<input
				ref={inputRef}
				value={name}
				onChange={(event) => setName(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") create();
					if (event.key === "Escape") onDone();
				}}
				placeholder={t("collection_name_placeholder")}
				className="h-8 min-w-0 flex-1 rounded-md bg-input px-2 text-sm text-text-1 outline-none focus:ring-2 focus:ring-accent/25"
			/>
			<button
				type="button"
				disabled={!valid}
				onClick={create}
				className="h-8 rounded-md bg-accent px-2.5 text-xs font-bold text-accent-contrast transition-opacity hover:opacity-90 disabled:opacity-35"
			>
				{t("collection_new")}
			</button>
			<button
				type="button"
				onClick={onDone}
				className="h-8 rounded-md px-2 text-xs font-semibold text-text-3 transition-colors hover:bg-input"
			>
				{t("cancel")}
			</button>
		</div>
	);
}
