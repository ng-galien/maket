import { ChevronRight } from "lucide-react";
import { useT } from "../../i18n/useT";
import type { DocSummary } from "../../store/types";
import { wsSend } from "../../store/ws";
import type { CategoryNode } from "./categoryTree";
import { DocCard, DocRow } from "./DocItem";
import type { DocItemProps, DocsCategoryModel, View } from "./types";
import { DRAG_MIME } from "./types";

export interface CategoryFactoryArgs {
	nodes: CategoryNode[];
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
	return buildNodeModels(args.nodes, args, 0);
}

function buildNodeModels(
	nodes: CategoryNode[],
	args: CategoryFactoryArgs,
	depth: number,
): DocsCategoryModel[] {
	return nodes.map((node) => ({
		name: node.name,
		path: node.path,
		depth,
		total: node.total,
		docs: node.docs,
		children: buildNodeModels(node.children, args, depth + 1),
		collapsed: !args.searching && args.collapsed.has(node.path),
		dropActive: args.dragOverCat === node.path,
		view: args.view,
		toggle: () => args.toggleCategory(node.path),
		dragOver: (event) => handleCategoryDragOver(event, node.path, args),
		dragLeave: (event) => handleCategoryDragLeave(event, node.path, args),
		drop: (event) => handleCategoryDrop(event, node.path, args),
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
		<div className="min-w-0">
			<DocsCategoryHeader model={model} />
			{!model.collapsed && (
				<>
					<DocsCategoryItems model={model} />
					{model.children.length > 0 && (
						<div className="relative">
							<div
								aria-hidden
								className="absolute top-0 bottom-2 w-px bg-border"
								style={{ left: `${16 + model.depth * 16}px` }}
							/>
							{model.children.map((child) => (
								<DocsCategory key={child.path} model={child} />
							))}
						</div>
					)}
				</>
			)}
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
			className={`w-full min-h-8 flex items-center gap-1 pr-2 py-0.5 rounded-md transition-colors group/cat ${
				model.dropActive
					? "bg-accent/15 ring-2 ring-accent/40"
					: "hover:bg-input/70"
			}`}
			style={{ paddingLeft: `${6 + model.depth * 16}px` }}
			aria-expanded={!model.collapsed}
			aria-label={t("category_toggle", { category: model.path })}
			title={model.path}
		>
			<span className="w-6 h-6 flex-shrink-0 grid place-items-center text-text-2 group-hover/cat:text-text-1">
				<ChevronRight
					size={14}
					className={`transition-transform duration-150 ${
						model.collapsed ? "" : "rotate-90"
					}`}
				/>
			</span>
			<span
				className={`text-base font-semibold flex-1 min-w-0 truncate text-left ${
					model.dropActive
						? "text-accent"
						: "text-text-2 group-hover/cat:text-text-1"
				}`}
			>
				{model.name}
			</span>
			<span
				className={`text-sm tabular-nums ${
					model.dropActive ? "text-accent" : "text-text-2"
				}`}
			>
				{model.dropActive ? t("doc_drop_here") : model.total}
			</span>
		</button>
	);
}

export function DocsCategoryItems({ model }: { model: DocsCategoryModel }) {
	if (model.docs.length === 0) return null;
	return (
		<div
			className={
				model.view === "grid"
					? "grid grid-cols-2 gap-2 px-1.5 py-1"
					: "flex flex-col gap-px"
			}
			style={{ marginLeft: `${16 + model.depth * 16}px` }}
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
