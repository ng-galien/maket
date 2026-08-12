import type { Collection } from "@maket/shared";
import { Database, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { wsSend } from "../store/ws";
import { HoldToDelete } from "./shared/HoldToDelete";

// code-moniker: ignore[smell-feature-envy-local]
// Collections panel shell: coordinates store-backed library focus with the
// overlay lifecycle so opening an editor also dismisses the blocking panel.
export function CollectionsTab() {
	const t = useT();
	const collections = useStore((s) => s.collections);
	const focusedCollectionName = useStore((s) => s.focusedCollectionName);
	const setFocusedCollection = useStore((s) => s.setFocusedCollection);
	const setActivePanel = useStore((s) => s.setActivePanel);
	const [naming, setNaming] = useState(false);
	const [deleting, setDeleting] = useState<string | null>(null);
	const openCollection = (name: string) => {
		setFocusedCollection(name);
		setActivePanel(null);
	};

	const sortedCollections = useMemo(
		() => [...collections].sort((a, b) => a.name.localeCompare(b.name)),
		[collections],
	);

	return (
		<div className="p-4 space-y-4">
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2 min-w-0">
					<Database size={18} className="text-accent shrink-0" />
					<h2 className="text-lg font-bold text-text-1 truncate">
						{t("collections")}
					</h2>
				</div>
				<button
					type="button"
					title={t("collection_new")}
					aria-label={t("collection_new")}
					onClick={() => setNaming(true)}
					className="w-8 h-8 rounded-full flex items-center justify-center text-white bg-accent hover:opacity-90 transition-opacity"
				>
					<Plus size={16} />
				</button>
			</div>

			{naming && (
				<NewCollectionForm
					existingNames={collections.map((collection) => collection.name)}
					onDone={() => setNaming(false)}
					onCreated={openCollection}
				/>
			)}

			{sortedCollections.length === 0 ? (
				<div className="text-sm text-text-3 bg-input rounded-lg p-3">
					{t("collection_none")}
				</div>
			) : (
				<div className="space-y-2">
					{sortedCollections.map((collection) => (
						<CollectionCard
							key={collection.name}
							collection={collection}
							active={focusedCollectionName === collection.name}
							deleting={deleting === collection.name}
							onOpen={() => openCollection(collection.name)}
							onAskDelete={() => setDeleting(collection.name)}
							onCancelDelete={() => setDeleting(null)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function CollectionCard({
	collection,
	active,
	deleting,
	onOpen,
	onAskDelete,
	onCancelDelete,
}: {
	collection: Collection;
	active: boolean;
	deleting: boolean;
	onOpen: () => void;
	onAskDelete: () => void;
	onCancelDelete: () => void;
}) {
	const t = useT();
	const fieldCount = Object.keys(collection.schema.properties ?? {}).length;
	return (
		<div
			className={`w-full rounded-lg border transition-colors ${
				active
					? "border-accent bg-accent-soft"
					: "border-border bg-panel hover:bg-input"
			}`}
		>
			<button type="button" onClick={onOpen} className="w-full text-left p-3">
				<div className="text-sm font-semibold text-text-1 truncate">
					{collection.name}
				</div>
				<div className="text-xs text-text-3 mt-1">
					{t("collection_summary_counts", {
						fields: fieldCount,
						rows: collection.members.length,
					})}
				</div>
			</button>
			{deleting ? (
				<div className="px-3 pb-3">
					<HoldToDelete
						label={t("collection_delete_hold", { name: collection.name })}
						onConfirm={() => {
							onCancelDelete();
							wsSend({ type: "collection_delete", name: collection.name });
						}}
						onCancel={onCancelDelete}
					/>
				</div>
			) : (
				<button
					type="button"
					title={t("delete")}
					aria-label={t("delete")}
					onClick={onAskDelete}
					className="ml-3 mb-3 w-8 h-8 rounded-md inline-flex items-center justify-center text-text-3 hover:text-danger hover:bg-input transition-colors"
				>
					<Trash2 size={14} />
				</button>
			)}
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
					properties: {
						client_name: { type: "string", title: "Client" },
					},
					required: ["client_name"],
					additionalProperties: false,
				},
				members: [{ id: "member_1", position: 0, data: { client_name: "" } }],
			},
		});
		onCreated(trimmed);
		onDone();
	};

	return (
		<div className="flex items-center gap-2 rounded-lg border border-border bg-panel p-2">
			<input
				ref={inputRef}
				value={name}
				onChange={(event) => setName(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") create();
					if (event.key === "Escape") onDone();
				}}
				placeholder={t("collection_name_placeholder")}
				className="min-w-0 flex-1 bg-input rounded-md px-2 py-1.5 text-sm text-text-1 outline-none focus:ring-2 focus:ring-accent/25"
			/>
			<button
				type="button"
				disabled={!valid}
				onClick={create}
				className="h-8 px-3 rounded-md text-xs font-bold text-white bg-accent hover:opacity-90 transition-opacity disabled:opacity-35"
			>
				{t("collection_new")}
			</button>
			<button
				type="button"
				onClick={onDone}
				className="h-8 px-2 rounded-md text-xs font-semibold text-text-3 hover:bg-input transition-colors"
			>
				{t("cancel")}
			</button>
		</div>
	);
}
