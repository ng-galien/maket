import type { DocSummary } from "../../store/types";

export type View = "list" | "grid";

export type RowMode =
	| { kind: "idle" }
	| { kind: "rename" }
	| { kind: "duplicate" }
	| { kind: "confirm-delete" };

export type CategoryMoveTarget =
	| { kind: "document"; name: string; category: string }
	| { kind: "asset"; name: string; category: string }
	| { kind: "category"; path: string };

export interface CategoryPickerModel {
	target: CategoryMoveTarget | null;
	categories: string[];
	close: () => void;
	moveTo: (path: string) => void;
}

export interface Query {
	categories: string[];
	locked: boolean | null;
	minRating: number;
	text: string;
}

export interface QueryChip {
	key: string;
	label: string;
	onRemove: () => void;
}

export interface DocsTabModel {
	toolbar: DocsToolbarModel;
	categories: DocsCategoryModel[];
	empty: boolean;
	selected: Set<string>;
	bulk: BulkActionBarProps;
	movePicker: CategoryPickerModel;
}

export interface DocsToolbarModel {
	search: string;
	setSearch: (value: string) => void;
	categories: string[];
	chips: QueryChip[];
	importInputRef: React.RefObject<HTMLInputElement | null>;
	importError: string | null;
	importDrag: boolean;
	clearImportError: () => void;
	startImport: () => void;
	handleImportInput: (event: React.ChangeEvent<HTMLInputElement>) => void;
	handleImportDragOver: (event: React.DragEvent) => void;
	handleImportDragLeave: () => void;
	handleImportDrop: (event: React.DragEvent) => void;
	view: View;
	setView: (view: View) => void;
}

export interface DocsCategoryModel {
	name: string;
	path: string;
	depth: number;
	total: number;
	openTotal: number;
	docs: DocSummary[];
	children: DocsCategoryModel[];
	collapsed: boolean;
	dropActive: boolean;
	menuOpen: boolean;
	renaming: boolean;
	view: View;
	toggle: () => void;
	openMenu: () => void;
	closeMenu: () => void;
	startMove: () => void;
	startRename: () => void;
	cancelRename: () => void;
	rename: (name: string) => void;
	dragOver: (event: React.DragEvent) => void;
	dragLeave: (event: React.DragEvent) => void;
	drop: (event: React.DragEvent) => void;
	itemFor: (doc: DocSummary) => DocItemProps;
}

export interface SelectionContext {
	selected: Set<string>;
	setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
	lastClicked: string | null;
	setLastClicked: (name: string) => void;
	flatOrder: string[];
	openDoc: (name: string) => void;
	clearSelection: () => void;
}

export interface DocItemModel {
	doc: DocSummary;
	onWs: boolean;
	focused: boolean;
	selected: boolean;
	menuOpen: boolean;
	mode: RowMode;
	canDelete: boolean;
	dragging: boolean;
}

export interface DocItemActions {
	click: (event: React.MouseEvent) => void;
	focus: () => void;
	openMenu: () => void;
	closeMenu: () => void;
	changeMode: (mode: RowMode) => void;
	moveCategory: () => void;
	dragStart: (event: React.DragEvent) => void;
	dragEnd: () => void;
}

export interface DocItemProps {
	model: DocItemModel;
	actions: DocItemActions;
}

export interface DocItemMeta {
	locked: boolean;
	editing: boolean;
	confirming: boolean;
	dragEnabled: boolean;
}

export interface DocItemRenderProps {
	model: DocItemModel;
	meta: DocItemMeta;
	actions: DocItemActions;
}

export interface DocItemMenuProps extends DocItemRenderProps {
	anchorRef: React.RefObject<HTMLButtonElement | null>;
}

export interface DocRowMenuButtonProps extends DocItemRenderProps {
	anchorRef: React.RefObject<HTMLButtonElement | null>;
}

export interface BulkActionBarModel {
	selected: Set<string>;
	docList: DocSummary[];
}

export interface BulkActionBarActions {
	clear: () => void;
	lock: () => void;
	unlock: () => void;
	recategorize: (cat: string) => void;
	delete: () => void;
	export: () => void;
}

export interface BulkActionBarProps {
	model: BulkActionBarModel;
	actions: BulkActionBarActions;
}

export interface DocMenuModel {
	doc: DocSummary;
	canDelete: boolean;
	locked: boolean;
}

export interface DocMenuActions {
	close: () => void;
	rename: () => void;
	duplicate: () => void;
	moveCategory: () => void;
	requestDelete: () => void;
}

export interface DocMenuProps {
	model: DocMenuModel;
	actions: DocMenuActions;
	anchorRef: React.RefObject<HTMLElement | null>;
}

export interface DocMenuViewModel {
	doc: DocSummary;
	canDelete: boolean;
	locked: boolean;
	ref: React.RefObject<HTMLDivElement | null>;
	pos: { top: number; right: number } | null;
	actions: DocMenuActions;
	copy: () => Promise<void>;
	toggleLock: () => void;
}

export interface InlineNameEditorProps {
	initial: string;
	placeholder: string;
	onCommit: (value: string) => void;
	onCancel: () => void;
}

export interface MenuItemProps {
	icon: React.ReactNode;
	children: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
	danger?: boolean;
}

export const DRAG_MIME = "application/x-maket-doc";
export const VIEW_KEY = "maket-docs-view";
export const COLLAPSED_KEY = "maket-categories-collapsed-v2";
