import { ChevronRight } from "lucide-react";
import { useRef } from "react";
import { useT } from "../../i18n/useT";
import type { DocSummary } from "../../store/types";
import { wsSend } from "../../store/ws";
import {
	CategoryInlineRename,
	CategoryMenu,
	CategoryMenuButton,
} from "./CategoryMenu";
import type { CategoryNode } from "./categoryTree";
import { DocCard, DocRow } from "./DocItem";
import type { DocItemProps, DocsCategoryModel, View } from "./types";
import { DRAG_MIME } from "./types";

const TREE_INDENT_PX = 16;
const CATEGORY_ROW_START_PX = 8;
const CATEGORY_CHEVRON_SIZE_PX = 24;
const CATEGORY_ROW_GAP_PX = 4;
const DOC_ROW_PADDING_PX = 8;

function categoryIndent(depth: number): number {
	return depth * TREE_INDENT_PX;
}

function categoryLabelOffset(depth: number): number {
	return (
		CATEGORY_ROW_START_PX +
		CATEGORY_CHEVRON_SIZE_PX +
		CATEGORY_ROW_GAP_PX +
		categoryIndent(depth)
	);
}

export interface CategoryFactoryArgs {
	nodes: CategoryNode[];
	searching: boolean;
	collapsed: Set<string>;
	toggleCategory: (cat: string) => void;
	dragOverCat: string | null;
	setDragOverCat: React.Dispatch<React.SetStateAction<string | null>>;
	setDraggingName: React.Dispatch<React.SetStateAction<string | null>>;
	categoryMenuFor: string | null;
	setCategoryMenuFor: React.Dispatch<React.SetStateAction<string | null>>;
	categoryRenameFor: string | null;
	setCategoryRenameFor: React.Dispatch<React.SetStateAction<string | null>>;
	requestCategoryMove: (path: string) => void;
	renameCategory: (path: string, name: string) => void;
	docList: DocSummary[];
	openDocNames: Set<string>;
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
	return nodes.map((node) => {
		const children = buildNodeModels(node.children, args, depth + 1);
		const openTotal =
			node.docs.filter((doc) => args.openDocNames.has(doc.name)).length +
			children.reduce((sum, child) => sum + child.openTotal, 0);
		return {
			name: node.name,
			path: node.path,
			depth,
			total: node.total,
			openTotal,
			docs: node.docs,
			children,
			collapsed: !args.searching && args.collapsed.has(node.path),
			dropActive: args.dragOverCat === node.path,
			menuOpen: args.categoryMenuFor === node.path,
			renaming: args.categoryRenameFor === node.path,
			view: args.view,
			toggle: () => args.toggleCategory(node.path),
			openMenu: () => args.setCategoryMenuFor(node.path),
			closeMenu: () => args.setCategoryMenuFor(null),
			startMove: () => {
				args.setCategoryMenuFor(null);
				args.requestCategoryMove(node.path);
			},
			startRename: () => {
				args.setCategoryMenuFor(null);
				args.setCategoryRenameFor(node.path);
			},
			cancelRename: () => args.setCategoryRenameFor(null),
			rename: (name) => {
				args.setCategoryRenameFor(null);
				args.renameCategory(node.path, name);
			},
			dragOver: (event) => handleCategoryDragOver(event, node.path, args),
			dragLeave: (event) => handleCategoryDragLeave(event, node.path, args),
			drop: (event) => handleCategoryDrop(event, node.path, args),
			itemFor: args.itemFor,
		};
	});
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
			{model.renaming ? (
				<CategoryInlineRename model={model} />
			) : (
				<DocsCategoryHeader model={model} />
			)}
			{!model.collapsed && (
				<>
					<DocsCategoryItems model={model} />
					{model.children.length > 0 && (
						<div className="relative">
							<div
								aria-hidden
								data-category-guide={model.path}
								className="absolute top-0 bottom-2 w-px bg-border"
								style={{
									left: `${CATEGORY_ROW_START_PX + CATEGORY_CHEVRON_SIZE_PX / 2 + categoryIndent(model.depth)}px`,
								}}
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
	const menuButtonRef = useRef<HTMLButtonElement>(null);
	return (
		<div
			onDragOver={model.dragOver}
			onDragLeave={model.dragLeave}
			onDrop={model.drop}
			className={`group/cat relative flex min-h-8 w-full items-center rounded-md transition-colors ${
				model.dropActive
					? "bg-accent/15 ring-2 ring-accent/40"
					: "hover:bg-input/70"
			}`}
			data-category-path={model.path}
		>
			<button
				type="button"
				onClick={model.toggle}
				className="flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left"
				style={{
					paddingLeft: `${CATEGORY_ROW_START_PX + categoryIndent(model.depth)}px`,
				}}
				aria-expanded={!model.collapsed}
				aria-label={t("category_toggle", { category: model.path })}
				aria-describedby={`category-count-${model.path}`}
				title={model.path}
			>
				<span
					data-category-content
					className="flex w-fit max-w-full min-w-0 items-center gap-1"
				>
					<span
						data-category-chevron
						className={`grid h-6 w-6 flex-shrink-0 place-items-center transition-colors ${
							model.dropActive
								? "text-accent"
								: model.collapsed
									? "text-text-1"
									: "text-accent"
						}`}
					>
						<ChevronRight
							size={14}
							strokeWidth={2.5}
							className={`transition-transform duration-150 ${
								model.collapsed ? "" : "rotate-90"
							}`}
						/>
					</span>
					<span
						data-category-label
						className={`min-w-0 truncate text-left text-base font-semibold ${
							model.dropActive ? "text-accent" : "text-text-1"
						}`}
					>
						{model.name}
					</span>
					<span
						id={`category-count-${model.path}`}
						data-category-count
						title={
							model.openTotal > 0
								? t("category_document_counts", {
										total: model.total,
										open: model.openTotal,
									})
								: t("category_document_total", { total: model.total })
						}
						className={`ml-1 inline-flex h-5 min-w-8 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-xs font-semibold leading-none tabular-nums transition-colors ${
							model.dropActive
								? "bg-accent text-white"
								: "bg-input/70 text-text-2 ring-1 ring-inset ring-border/70"
						}`}
					>
						{model.dropActive ? (
							t("doc_drop_here")
						) : (
							<>
								<span data-category-total>{model.total}</span>
								{model.openTotal > 0 && (
									<>
										<span aria-hidden className="text-text-3">
											/
										</span>
										<span data-category-open-count className="text-accent">
											{model.openTotal}
										</span>
									</>
								)}
							</>
						)}
					</span>
				</span>
			</button>
			<CategoryMenuButton model={model} anchorRef={menuButtonRef} />
			<CategoryMenu model={model} anchorRef={menuButtonRef} />
		</div>
	);
}

export function DocsCategoryItems({ model }: { model: DocsCategoryModel }) {
	if (model.docs.length === 0) return null;
	return (
		<div
			data-category-documents={model.path}
			className={
				model.view === "grid"
					? "grid grid-cols-2 gap-2 px-1.5 py-1"
					: "flex flex-col gap-px"
			}
			style={{
				marginLeft: `${categoryLabelOffset(model.depth) - DOC_ROW_PADDING_PX}px`,
			}}
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
