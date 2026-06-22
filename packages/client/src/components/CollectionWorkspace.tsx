import type { Collection } from "@maket/shared";
import { Plus, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store/useStore";
import { wsSend } from "../store/ws";

export function CollectionWorkspace({ zoomK }: { zoomK: number }) {
	const focusedCollectionName = useStore((s) => s.focusedCollectionName);
	const collection = useStore((s) =>
		s.collections.find((item) => item.name === focusedCollectionName),
	);
	const setFocusedCollection = useStore((s) => s.setFocusedCollection);

	if (!collection) return null;

	const labelScale = 1 / Math.max(zoomK, 0.1);

	return (
		<div className="flex flex-col items-center shrink-0 select-none">
			<CollectionEditor collection={collection} />
			<div
				className="doc-label relative mt-3"
				style={{
					transform: `scale(${labelScale})`,
					transformOrigin: "top center",
				}}
			>
				<div className="flex items-center gap-1.5 px-3 py-1 rounded-xl whitespace-nowrap overflow-hidden bg-accent-soft">
					<span className="text-base font-bold text-accent truncate">
						{collection.name}
					</span>
					<span className="text-2xs text-text-3 shrink-0">
						{Object.keys(collection.schema.properties ?? {}).length} champ(s) ·{" "}
						{collection.members.length} membre(s)
					</span>
					<button
						type="button"
						onClick={() => setFocusedCollection(null)}
						className="w-5 h-5 rounded-md flex items-center justify-center text-text-3 p-0 border-none bg-transparent cursor-pointer shrink-0"
					>
						<X size={12} />
					</button>
				</div>
			</div>
		</div>
	);
}

function CollectionEditor({ collection }: { collection: Collection }) {
	const [draft, setDraft] = useState(collection);
	const fields = useMemo(() => collectionFields(draft), [draft]);

	useEffect(() => {
		setDraft(collection);
	}, [collection]);

	const updateValue = (memberId: string, key: string, value: string) => {
		setDraft((current) => ({
			...current,
			members: current.members.map((member) =>
				member.id === memberId
					? { ...member, data: { ...member.data, [key]: value } }
					: member,
			),
		}));
	};

	const addMember = () => {
		setDraft((current) => ({
			...current,
			members: [
				...current.members,
				{
					id: `member_${Date.now().toString(36)}`,
					position: current.members.length,
					data: Object.fromEntries(fields.map((field) => [field, ""])),
				},
			],
		}));
	};

	return (
		<div className="w-[780px] max-w-[80vw] bg-panel border border-border rounded-lg shadow-xl overflow-hidden">
			<div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
				<div className="min-w-0">
					<div className="w-full text-lg font-bold text-text-1 truncate">
						{draft.name}
					</div>
					<input
						value={draft.description ?? ""}
						onChange={(event) =>
							setDraft((current) => ({
								...current,
								description: event.target.value,
							}))
						}
						placeholder="Description"
						className="w-full bg-transparent text-sm text-text-3 outline-none"
					/>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<button
						type="button"
						title="Ajouter un membre"
						aria-label="Ajouter un membre"
						onClick={addMember}
						className="w-9 h-9 rounded-full flex items-center justify-center text-text-2 hover:bg-input transition-colors"
					>
						<Plus size={16} />
					</button>
					<button
						type="button"
						title="Enregistrer"
						aria-label="Enregistrer"
						onClick={() =>
							wsSend({ type: "collection_save", collection: draft })
						}
						className="w-9 h-9 rounded-full flex items-center justify-center text-white bg-accent hover:opacity-90 transition-opacity"
					>
						<Save size={16} />
					</button>
				</div>
			</div>

			<div className="overflow-auto max-h-[560px]">
				<table className="w-full text-sm border-collapse">
					<thead className="sticky top-0 bg-panel border-b border-border">
						<tr>
							<th className="text-left font-semibold text-text-3 px-3 py-2 w-28">
								Membre
							</th>
							{fields.map((field) => (
								<th
									key={field}
									className="text-left font-semibold text-text-3 px-3 py-2 min-w-36"
								>
									{field}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{draft.members
							.slice()
							.sort((a, b) => a.position - b.position)
							.map((member) => (
								<tr key={member.id} className="border-b border-border/60">
									<td className="px-3 py-2 text-text-3">{member.id}</td>
									{fields.map((field) => (
										<td key={field} className="px-2 py-1">
											<input
												value={String(member.data[field] ?? "")}
												onChange={(event) =>
													updateValue(member.id, field, event.target.value)
												}
												className="w-full bg-input rounded-md px-2 py-1.5 text-text-1 outline-none focus:ring-2 focus:ring-accent/25"
											/>
										</td>
									))}
								</tr>
							))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function collectionFields(collection: Collection): string[] {
	return Object.keys(collection.schema.properties ?? {});
}
