import { useRef } from "react";
import { useT } from "../../i18n/useT";
import type { DocSummary } from "../../store/types";
import { wsSend } from "../../store/ws";
import {
	LibraryCategoryHeader,
	libraryCategoryGuideOffset,
	libraryCategoryLabelOffset,
} from "../shared/LibraryCategoryHeader";
import {
	CategoryInlineRename,
	CategoryMenu,
	CategoryMenuButton,
} from "./CategoryMenu";
import type { CategoryNode } from "./categoryTree";
import { DocCard, DocRow } from "./DocItem";
import type { DocItemProps, DocsCategoryModel, View } from "./types";
import { DRAG_MIME } from "./types";

const DOC_ROW_PADDING_PX = 8;

export interface CategoryFactoryArgs {
	nodes: CategoryNode[];
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
			collapsed: args.collapsed.has(node.path),
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
									left: `${libraryCategoryGuideOffset(model.depth)}px`,
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
	const countTitle =
		model.openTotal > 0
			? t("category_document_counts", {
					total: model.total,
					open: model.openTotal,
				})
			: t("category_document_total", { total: model.total });
	return (
		<LibraryCategoryHeader
			model={{ ...model, activeTotal: model.openTotal }}
			toggleLabel={t("category_toggle", { category: model.path })}
			countTitle={countTitle}
			actions={
				<>
					<CategoryMenuButton model={model} anchorRef={menuButtonRef} />
					<CategoryMenu model={model} anchorRef={menuButtonRef} />
				</>
			}
		/>
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
				marginLeft: `${libraryCategoryLabelOffset(model.depth) - DOC_ROW_PADDING_PX}px`,
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
