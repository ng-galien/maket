import { FolderInput, MoreVertical, Pencil } from "lucide-react";
import { useT } from "../../i18n/useT";
import { AnchoredMenu, AnchoredMenuItem } from "../shared/AnchoredMenu";
import { InlineNameEditor } from "./DocMenu";

export interface CategoryActionModel {
	name: string;
	path: string;
	depth: number;
	menuOpen: boolean;
	openMenu: () => void;
	closeMenu: () => void;
	startMove: () => void;
	startRename: () => void;
	cancelRename: () => void;
	rename: (name: string) => void;
}

export function CategoryMenuButton({
	model,
	anchorRef,
}: {
	model: CategoryActionModel;
	anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
	const t = useT();
	return (
		<button
			ref={anchorRef}
			type="button"
			aria-label={t("category_menu", { category: model.path })}
			aria-haspopup="menu"
			aria-expanded={model.menuOpen}
			onClick={(event) => {
				event.stopPropagation();
				if (model.menuOpen) model.closeMenu();
				else model.openMenu();
			}}
			className={`grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 transition hover:bg-input hover:text-text-1 ${
				model.menuOpen
					? "bg-input text-text-1"
					: "opacity-0 group-hover/cat:opacity-100 focus:opacity-100"
			}`}
		>
			<MoreVertical size={16} />
		</button>
	);
}

export function CategoryMenu({
	model,
	anchorRef,
}: {
	model: CategoryActionModel;
	anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
	const t = useT();
	if (!model.menuOpen) return null;
	return (
		<AnchoredMenu
			anchorRef={anchorRef}
			onClose={model.closeMenu}
			ariaLabel={t("category_menu", { category: model.path })}
		>
			<AnchoredMenuItem icon={<Pencil size={14} />} onClick={model.startRename}>
				{t("category_rename")}
			</AnchoredMenuItem>
			<AnchoredMenuItem
				icon={<FolderInput size={14} />}
				onClick={model.startMove}
			>
				{t("category_move")}
			</AnchoredMenuItem>
		</AnchoredMenu>
	);
}

export function CategoryInlineRename({
	model,
}: {
	model: CategoryActionModel;
}) {
	const t = useT();
	return (
		<div
			className="py-1 pr-2"
			style={{ paddingLeft: `${8 + model.depth * 16}px` }}
		>
			<InlineNameEditor
				initial={model.name}
				placeholder={t("category_rename_prompt")}
				onCommit={model.rename}
				onCancel={model.cancelRename}
			/>
		</div>
	);
}
