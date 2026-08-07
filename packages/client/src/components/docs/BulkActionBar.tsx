import { normalizeCategoryPath } from "@maket/shared";
import { Download } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n/useT";
import type { DocSummary } from "../../store/types";
import { categoryPathsForDocs } from "./categoryTree";
import type {
	BulkActionBarActions,
	BulkActionBarModel,
	BulkActionBarProps,
} from "./types";

export function BulkActionBar({ model, actions }: BulkActionBarProps) {
	const bar = useBulkActionBarModel(model, actions);
	const t = useT();
	return (
		<div className="sticky bottom-2 mx-1 mt-2 rounded-xl bg-panel shadow-[0_12px_40px_rgba(0,0,0,0.18)] border border-black/5 p-2 flex items-center gap-1.5 z-40">
			<span className="px-2 text-2xs font-bold text-text-3 tabular-nums">
				{t("bulk_selected", { count: String(model.selected.size) })}
			</span>
			<div className="flex-1 min-w-0 flex items-center gap-1 flex-wrap">
				<BulkCategoryPicker model={bar.categoryPicker} />
				<BulkExportButton
					onClick={actions.export}
					disabled={bar.exportDisabled}
				/>
				{bar.anyUnlocked && (
					<BulkTextButton onClick={actions.lock} label={t("doc_lock")} />
				)}
				{bar.anyLocked && (
					<BulkTextButton onClick={actions.unlock} label={t("doc_unlock")} />
				)}
				<BulkDeleteButton model={bar.deleteButton} />
			</div>
			<button
				type="button"
				onClick={actions.clear}
				aria-label={t("bulk_clear")}
				className="w-7 h-7 rounded-md flex items-center justify-center text-text-3 hover:bg-black/[0.05] transition"
			>
				<span aria-hidden className="text-base leading-none">
					×
				</span>
			</button>
		</div>
	);
}

interface BulkActionBarViewModel {
	anyUnlocked: boolean;
	anyLocked: boolean;
	exportDisabled: boolean;
	categoryPicker: BulkCategoryPickerModel;
	deleteButton: BulkDeleteButtonModel;
}

interface BulkCategoryPickerModel {
	categories: string[];
	show: boolean;
	creating: boolean;
	anchorRef: React.RefObject<HTMLDivElement | null>;
	menuRef: React.RefObject<HTMLDivElement | null>;
	newInputRef: React.RefObject<HTMLInputElement | null>;
	toggle: () => void;
	startCreating: () => void;
	cancelCreating: () => void;
	commit: (cat: string) => void;
	recategorize: (cat: string) => void;
}

interface BulkDeleteButtonModel {
	confirming: boolean;
	disabled: boolean;
	request: () => void;
	confirm: () => void;
}

function useBulkActionBarModel(
	model: BulkActionBarModel,
	actions: BulkActionBarActions,
): BulkActionBarViewModel {
	const { selected, docList } = model;
	const [showCatPicker, setShowCatPicker] = useState(false);
	const [showConfirmDelete, setShowConfirmDelete] = useState(false);
	const [creatingCat, setCreatingCat] = useState(false);
	const anchorRef = useRef<HTMLDivElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const newCatInputRef = useRef<HTMLInputElement>(null);
	useFocusNewCategoryInput(creatingCat, newCatInputRef);
	useCloseCategoryPicker(showCatPicker, anchorRef, menuRef, () => {
		setShowCatPicker(false);
		setCreatingCat(false);
	});
	const selectedDocs = docList.filter((doc) => selected.has(doc.name));
	return {
		anyUnlocked: selectedDocs.some((doc) => doc.locked !== true),
		anyLocked: selectedDocs.some((doc) => doc.locked === true),
		exportDisabled: selectedDocs.some((doc) => doc.dataModel === "state"),
		categoryPicker: createBulkCategoryPickerModel({
			docList,
			actions,
			showCatPicker,
			setShowCatPicker,
			creatingCat,
			setCreatingCat,
			anchorRef,
			menuRef,
			newCatInputRef,
		}),
		deleteButton: createBulkDeleteButtonModel({
			docList,
			selectedDocs,
			showConfirmDelete,
			setShowConfirmDelete,
			deleteSelected: actions.delete,
		}),
	};
}

function useFocusNewCategoryInput(
	creatingCat: boolean,
	inputRef: React.RefObject<HTMLInputElement | null>,
) {
	useEffect(() => {
		if (creatingCat) inputRef.current?.focus();
	}, [creatingCat, inputRef]);
}

function useCloseCategoryPicker(
	showCatPicker: boolean,
	anchorRef: React.RefObject<HTMLDivElement | null>,
	menuRef: React.RefObject<HTMLDivElement | null>,
	close: () => void,
) {
	useEffect(() => {
		if (!showCatPicker) return;
		const onDocClick = (event: MouseEvent) => {
			const target = event.target as Node;
			if (
				!anchorRef.current?.contains(target) &&
				!menuRef.current?.contains(target)
			)
				close();
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		document.addEventListener("mousedown", onDocClick);
		document.addEventListener("keydown", onKey);
		window.addEventListener("resize", close);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("resize", close);
		};
	}, [anchorRef, close, menuRef, showCatPicker]);
}

interface BulkCategoryPickerFactoryArgs {
	docList: DocSummary[];
	actions: BulkActionBarActions;
	showCatPicker: boolean;
	setShowCatPicker: React.Dispatch<React.SetStateAction<boolean>>;
	creatingCat: boolean;
	setCreatingCat: React.Dispatch<React.SetStateAction<boolean>>;
	anchorRef: React.RefObject<HTMLDivElement | null>;
	menuRef: React.RefObject<HTMLDivElement | null>;
	newCatInputRef: React.RefObject<HTMLInputElement | null>;
}

function createBulkCategoryPickerModel(
	args: BulkCategoryPickerFactoryArgs,
): BulkCategoryPickerModel {
	return {
		categories: categoryPathsForDocs(args.docList),
		show: args.showCatPicker,
		creating: args.creatingCat,
		anchorRef: args.anchorRef,
		menuRef: args.menuRef,
		newInputRef: args.newCatInputRef,
		toggle: () => args.setShowCatPicker((show) => !show),
		startCreating: () => args.setCreatingCat(true),
		cancelCreating: () => args.setCreatingCat(false),
		commit: (cat) => commitNewCategory(cat, args),
		recategorize: (cat) => {
			args.setShowCatPicker(false);
			args.actions.recategorize(normalizeCategoryPath(cat));
		},
	};
}

function commitNewCategory(cat: string, args: BulkCategoryPickerFactoryArgs) {
	const raw = cat.trim();
	args.setCreatingCat(false);
	args.setShowCatPicker(false);
	if (raw) args.actions.recategorize(normalizeCategoryPath(raw));
}

interface BulkDeleteFactoryArgs {
	docList: DocSummary[];
	selectedDocs: DocSummary[];
	showConfirmDelete: boolean;
	setShowConfirmDelete: React.Dispatch<React.SetStateAction<boolean>>;
	deleteSelected: () => void;
}

function createBulkDeleteButtonModel(
	args: BulkDeleteFactoryArgs,
): BulkDeleteButtonModel {
	const anyDeletable = args.selectedDocs.some((doc) => doc.locked !== true);
	const unlockedCount = args.selectedDocs.filter(
		(doc) => doc.locked !== true,
	).length;
	return {
		confirming: args.showConfirmDelete,
		disabled: !anyDeletable || args.docList.length - unlockedCount < 1,
		request: () => args.setShowConfirmDelete(true),
		confirm: () => {
			args.setShowConfirmDelete(false);
			args.deleteSelected();
		},
	};
}

function BulkCategoryPicker({ model }: { model: BulkCategoryPickerModel }) {
	const t = useT();
	return (
		<div ref={model.anchorRef} className="relative">
			<button
				type="button"
				onClick={model.toggle}
				className="px-2 py-1 rounded-md text-xs font-semibold text-text-1 hover:bg-black/[0.05] transition"
			>
				{t("bulk_move_category")}
			</button>
			{model.show && <BulkCategoryMenu model={model} />}
		</div>
	);
}

function BulkCategoryMenu({ model }: { model: BulkCategoryPickerModel }) {
	const [position, setPosition] = useState<{
		left: number;
		bottom: number;
		maxHeight: number;
	} | null>(null);
	useLayoutEffect(() => {
		const rect = model.anchorRef.current?.getBoundingClientRect();
		if (!rect) return;
		setPosition({
			left: Math.max(8, Math.min(rect.left, window.innerWidth - 232)),
			bottom: window.innerHeight - rect.top + 4,
			maxHeight: Math.max(120, rect.top - 12),
		});
	}, [model.anchorRef]);
	if (!position) return null;
	return createPortal(
		<div
			ref={model.menuRef}
			className="fixed z-[var(--z-modal)] w-56 overflow-y-auto bg-panel rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.18)] border border-black/5 py-1"
			style={position}
		>
			{!model.creating &&
				model.categories.map((cat) => (
					<button
						key={cat}
						type="button"
						onClick={() => model.recategorize(cat)}
						className="w-full text-left pr-3 py-1.5 text-sm hover:bg-black/[0.05] transition"
						style={{
							paddingLeft: `${12 + (cat.split("/").length - 1) * 12}px`,
						}}
						title={cat}
					>
						<span className="font-mono text-xs">{cat.split("/").at(-1)}</span>
					</button>
				))}
			{!model.creating && <div className="h-px bg-black/[0.06] my-1" />}
			{model.creating ? (
				<NewCategoryInput model={model} />
			) : (
				<NewCategoryButton onClick={model.startCreating} />
			)}
		</div>,
		document.body,
	);
}

function NewCategoryInput({ model }: { model: BulkCategoryPickerModel }) {
	const t = useT();
	return (
		<input
			ref={model.newInputRef}
			type="text"
			placeholder={t("bulk_new_category")}
			onKeyDown={(event) => handleNewCategoryKey(event, model)}
			onBlur={model.cancelCreating}
			className="w-full px-3 py-1.5 text-sm bg-transparent outline-none placeholder:text-text-3 border-b border-accent/40"
		/>
	);
}

function handleNewCategoryKey(
	event: React.KeyboardEvent<HTMLInputElement>,
	model: BulkCategoryPickerModel,
) {
	if (event.key === "Enter") {
		model.commit(event.currentTarget.value);
	} else if (event.key === "Escape") {
		event.currentTarget.value = "";
		model.cancelCreating();
	}
}

function NewCategoryButton({ onClick }: { onClick: () => void }) {
	const t = useT();
	return (
		<button
			type="button"
			onClick={onClick}
			className="w-full text-left px-3 py-1.5 text-sm text-accent hover:bg-accent/5 transition font-semibold"
		>
			+ {t("bulk_new_category_cta")}
		</button>
	);
}

function BulkExportButton({
	onClick,
	disabled,
}: {
	onClick: () => void;
	disabled: boolean;
}) {
	const t = useT();
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={disabled ? t("state_document_export_unavailable") : undefined}
			className={`px-2 py-1 rounded-md text-xs font-semibold transition inline-flex items-center gap-1 ${
				disabled
					? "text-text-3 cursor-not-allowed"
					: "text-text-1 hover:bg-black/[0.05]"
			}`}
		>
			<Download size={12} />
			{t("bulk_export_maket")}
		</button>
	);
}

function BulkTextButton({
	onClick,
	label,
}: {
	onClick: () => void;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="px-2 py-1 rounded-md text-xs font-semibold text-text-1 hover:bg-black/[0.05] transition"
		>
			{label}
		</button>
	);
}

function BulkDeleteButton({ model }: { model: BulkDeleteButtonModel }) {
	const t = useT();
	if (model.confirming) {
		return (
			<button
				type="button"
				onClick={model.confirm}
				className="px-2 py-1 rounded-md text-xs font-bold bg-danger text-white hover:brightness-110 transition"
			>
				{t("bulk_confirm_delete")}
			</button>
		);
	}
	return (
		<button
			type="button"
			disabled={model.disabled}
			onClick={model.request}
			className={`px-2 py-1 rounded-md text-xs font-semibold transition ${
				model.disabled
					? "text-text-3 cursor-not-allowed"
					: "text-danger hover:bg-danger-soft"
			}`}
		>
			{t("doc_delete")}
		</button>
	);
}
