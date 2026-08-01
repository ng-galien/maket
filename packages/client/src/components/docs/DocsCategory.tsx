import { ChevronRight } from "lucide-react";
import { useT } from "../../i18n/useT";
import type { DocSummary } from "../../store/types";
import { wsSend } from "../../store/ws";
import { DocCard, DocRow } from "./DocItem";
import type { DocItemProps, DocsCategoryModel, View } from "./types";
import { DRAG_MIME } from "./types";

export function catColor(cat: string): string {
	const COLORS = [
		"#60a5fa",
		"#a78bfa",
		"#f59e0b",
		"#10b981",
		"#f472b6",
		"#34d399",
		"#fb923c",
	];
	let h = 0;
	for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) | 0;
	return COLORS[Math.abs(h) % COLORS.length];
}

export interface CategoryFactoryArgs {
	grouped: Map<string, DocSummary[]>;
	searching: boolean;
	collapsed: Set<string>;
	toggleCategory: (cat: string) => void;
	dragOverCat: string | null;
	setDragOverCat: React.Dispatch<React.SetStateAction<string | null>>;
	setDraggingName: React.Dispatch<React.SetStateAction<string | null>>;
	docList: DocSummary[];
	view: View;
	itemFor: (doc: DocSummary) => DocItemProps;
}

export function buildCategoryModels(
	args: CategoryFactoryArgs,
): DocsCategoryModel[] {
	return [...args.grouped.entries()].map(([cat, docs]) => ({
		name: cat,
		docs,
		collapsed: !args.searching && args.collapsed.has(cat),
		dropActive: args.dragOverCat === cat,
		view: args.view,
		toggle: () => args.toggleCategory(cat),
		dragOver: (event) => handleCategoryDragOver(event, cat, args),
		dragLeave: (event) => handleCategoryDragLeave(event, cat, args),
		drop: (event) => handleCategoryDrop(event, cat, args),
		itemFor: args.itemFor,
	}));
}

function handleCategoryDragOver(
	event: React.DragEvent,
	cat: string,
	args: CategoryFactoryArgs,
) {
	if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
	event.preventDefault();
	event.dataTransfer.dropEffect = "move";
	if (args.dragOverCat !== cat) args.setDragOverCat(cat);
}

function handleCategoryDragLeave(
	event: React.DragEvent,
	cat: string,
	args: CategoryFactoryArgs,
) {
	const related = event.relatedTarget as Node | null;
	if (!related || !event.currentTarget.contains(related)) {
		args.setDragOverCat((current) => (current === cat ? null : current));
	}
}

function handleCategoryDrop(
	event: React.DragEvent,
	cat: string,
	args: CategoryFactoryArgs,
) {
	const name = event.dataTransfer.getData(DRAG_MIME);
	args.setDragOverCat(null);
	args.setDraggingName(null);
	if (!name) return;
	const src = args.docList.find((doc) => doc.name === name);
	if (!src || src.category === cat) return;
	wsSend({ type: "update_meta", docName: name, category: cat });
}

export function DocsCategory({ model }: { model: DocsCategoryModel }) {
	return (
		<div>
			<DocsCategoryHeader model={model} />
			{!model.collapsed && <DocsCategoryItems model={model} />}
		</div>
	);
}

export function DocsCategoryHeader({ model }: { model: DocsCategoryModel }) {
	const t = useT();
	return (
		<button
			type="button"
			onClick={model.toggle}
			onDragOver={model.dragOver}
			onDragLeave={model.dragLeave}
			onDrop={model.drop}
			className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition group/cat ${
				model.dropActive
					? "bg-accent/15 ring-2 ring-accent/40"
					: "hover:bg-black/[0.03]"
			}`}
			aria-expanded={!model.collapsed}
		>
			<ChevronRight
				size={11}
				className={`text-text-3 flex-shrink-0 transition-transform duration-150 ${
					model.collapsed ? "" : "rotate-90"
				}`}
			/>
			<CategoryDot name={model.name} />
			<span
				className={`text-xs font-bold uppercase tracking-wider flex-1 text-left ${
					model.dropActive ? "text-accent" : "text-text-3"
				}`}
			>
				{model.name}
			</span>
			<span
				className={`text-xs tabular-nums ${
					model.dropActive ? "text-accent" : "text-text-3"
				}`}
			>
				{model.dropActive ? t("doc_drop_here") : model.docs.length}
			</span>
		</button>
	);
}

function CategoryDot({ name }: { name: string }) {
	return (
		<div
			style={{
				width: 8,
				height: 8,
				borderRadius: "50%",
				background: catColor(name),
				flexShrink: 0,
			}}
		/>
	);
}

export function DocsCategoryItems({ model }: { model: DocsCategoryModel }) {
	return (
		<div
			className={
				model.view === "grid"
					? "grid grid-cols-2 gap-2 mt-1"
					: "flex flex-col gap-0.5 mt-0.5"
			}
		>
			{model.docs.map((doc) => {
				const itemProps = model.itemFor(doc);
				return model.view === "grid" ? (
					<DocCard key={doc.name} {...itemProps} />
				) : (
					<DocRow key={doc.name} {...itemProps} />
				);
			})}
		</div>
	);
}
