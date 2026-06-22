import { Database, Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useStore } from "../store/useStore";
import { wsSend } from "../store/ws";

export function CollectionsTab() {
	const collections = useStore((s) => s.collections);
	const focusedCollectionName = useStore((s) => s.focusedCollectionName);
	const setFocusedCollection = useStore((s) => s.setFocusedCollection);

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
						Collections
					</h2>
				</div>
				<button
					type="button"
					title="Nouvelle collection"
					aria-label="Nouvelle collection"
					onClick={createCollection}
					className="w-8 h-8 rounded-full flex items-center justify-center text-white bg-accent hover:opacity-90 transition-opacity"
				>
					<Plus size={16} />
				</button>
			</div>

			{sortedCollections.length === 0 ? (
				<div className="text-sm text-text-3 bg-input rounded-lg p-3">
					Aucune collection.
				</div>
			) : (
				<div className="space-y-2">
					{sortedCollections.map((collection) => {
						const fields = Object.keys(collection.schema.properties ?? {});
						const active = focusedCollectionName === collection.name;
						return (
							<div
								key={collection.name}
								className={`w-full rounded-lg border transition-colors ${
									active
										? "border-accent bg-accent-soft"
										: "border-border bg-panel hover:bg-input"
								}`}
							>
								<button
									type="button"
									onClick={() => setFocusedCollection(collection.name)}
									className="w-full text-left p-3"
								>
									<div className="text-sm font-semibold text-text-1 truncate">
										{collection.name}
									</div>
									<div className="text-xs text-text-3 mt-1">
										{fields.length} champ(s) · {collection.members.length}{" "}
										membre(s)
									</div>
								</button>
								<button
									type="button"
									title="Supprimer"
									aria-label="Supprimer"
									onClick={() =>
										wsSend({
											type: "collection_delete",
											name: collection.name,
										})
									}
									className="ml-3 mb-3 w-8 h-8 rounded-md inline-flex items-center justify-center text-text-3 hover:text-danger hover:bg-input transition-colors"
								>
									<Trash2 size={14} />
								</button>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function createCollection(): void {
	const name = `collection_${Date.now().toString(36)}`;
	wsSend({
		type: "collection_save",
		collection: {
			name,
			description: "",
			schema: {
				type: "object",
				properties: {
					client_name: { type: "string", title: "Client" },
				},
				required: ["client_name"],
				additionalProperties: false,
			},
			members: [
				{
					id: "member_1",
					position: 0,
					data: { client_name: "" },
				},
			],
		},
	});
	useStore.getState().setFocusedCollection(name);
}
