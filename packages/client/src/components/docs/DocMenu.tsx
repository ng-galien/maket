import {
	Copy,
	Download,
	Files,
	FolderInput,
	Lock,
	MoreVertical,
	Pencil,
	Trash2,
	Unlock,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/useT";
import {
	sendDeleteDoc,
	sendDuplicateDoc,
	sendLockDoc,
	sendRenameDoc,
} from "../../store/ws";
import { copyToClipboard } from "../../utils";
import { AnchoredMenu, AnchoredMenuItem } from "../shared/AnchoredMenu";
import { HoldToDelete } from "../shared/HoldToDelete";
import { exportMaketBundle } from "./docsImportExport";
import type {
	DocItemActions,
	DocItemMenuProps,
	DocItemModel,
	DocItemProps,
	DocMenuProps,
	DocRowMenuButtonProps,
	InlineNameEditorProps,
	RowMode,
} from "./types";

export function DocRowMenuButton({
	model,
	meta,
	actions,
	anchorRef,
}: DocRowMenuButtonProps) {
	if (meta.editing || meta.confirming) return null;
	return (
		<DocMenuButton
			model={model}
			actions={actions}
			anchorRef={anchorRef}
			size="row"
		/>
	);
}

export function DocMenuButton({
	model,
	actions,
	anchorRef,
	size,
}: {
	model: DocItemModel;
	actions: DocItemActions;
	anchorRef: React.RefObject<HTMLButtonElement | null>;
	size: "card" | "row";
}) {
	const t = useT();
	const buttonSize = size === "card" ? "w-7 h-7" : "w-8 h-8 shrink-0";
	const hover =
		size === "card"
			? "group-hover/card:opacity-100"
			: "group-hover:opacity-100";
	return (
		<button
			ref={anchorRef}
			type="button"
			aria-label={t("doc_menu")}
			aria-haspopup="menu"
			aria-expanded={model.menuOpen}
			onClick={(event) => toggleDocMenu(event, model, actions)}
			className={`${buttonSize} rounded-md flex items-center justify-center text-text-3 hover:bg-black/[0.06] transition ${
				model.menuOpen
					? "bg-black/[0.06]"
					: `opacity-0 ${hover} focus:opacity-100`
			}`}
		>
			<MoreVertical size={size === "card" ? 15 : 16} />
		</button>
	);
}

function toggleDocMenu(
	event: React.MouseEvent,
	model: DocItemModel,
	actions: DocItemActions,
) {
	event.stopPropagation();
	if (model.menuOpen) actions.closeMenu();
	else actions.openMenu();
}

export function DocInlineNameEditor({ model, actions }: DocItemProps) {
	const t = useT();
	return (
		<InlineNameEditor
			initial={
				model.mode.kind === "rename" ? model.doc.name : `${model.doc.name} copy`
			}
			placeholder={
				model.mode.kind === "rename"
					? t("doc_rename_prompt")
					: t("doc_duplicate_prompt")
			}
			onCommit={(value) => commitDocName(value, model, actions)}
			onCancel={() => actions.changeMode({ kind: "idle" })}
		/>
	);
}

function commitDocName(
	value: string,
	model: DocItemModel,
	actions: DocItemActions,
) {
	const trimmed = value.trim();
	actions.changeMode({ kind: "idle" });
	if (!trimmed) return;
	if (model.mode.kind === "rename") {
		if (trimmed !== model.doc.name) sendRenameDoc(model.doc.name, trimmed);
	} else {
		sendDuplicateDoc(model.doc.name, trimmed);
	}
}

export function DocDeleteHold({ model, actions }: DocItemProps) {
	const t = useT();
	return (
		<HoldToDelete
			label={t("doc_delete_hold", { name: model.doc.name })}
			onConfirm={() => {
				actions.changeMode({ kind: "idle" });
				sendDeleteDoc(model.doc.name);
			}}
			onCancel={() => actions.changeMode({ kind: "idle" })}
		/>
	);
}

export function DocItemMenu({
	model,
	meta,
	actions,
	anchorRef,
}: DocItemMenuProps) {
	if (!model.menuOpen) return null;
	return (
		<DocMenu
			model={{
				doc: model.doc,
				canDelete: model.canDelete,
				locked: meta.locked,
			}}
			actions={{
				close: actions.closeMenu,
				rename: () => changeDocMenuMode(actions, "rename"),
				duplicate: () => changeDocMenuMode(actions, "duplicate"),
				moveCategory: () => {
					actions.closeMenu();
					actions.moveCategory();
				},
				requestDelete: () => changeDocMenuMode(actions, "confirm-delete"),
			}}
			anchorRef={anchorRef}
		/>
	);
}

function changeDocMenuMode(actions: DocItemActions, kind: RowMode["kind"]) {
	actions.closeMenu();
	actions.changeMode({ kind } as RowMode);
}

export function InlineNameEditor({
	initial,
	placeholder,
	onCommit,
	onCancel,
}: InlineNameEditorProps) {
	const [value, setValue] = useState(initial);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.focus();
		const base = initial.replace(/ copy$/, "");
		el.setSelectionRange(0, base.length);
	}, [initial]);

	return (
		<div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-accent/5 ring-2 ring-accent/30">
			<div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 bg-accent/10">
				<Pencil size={13} className="text-accent" />
			</div>
			<input
				ref={inputRef}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						onCommit(value);
					} else if (e.key === "Escape") {
						e.preventDefault();
						onCancel();
					}
				}}
				onBlur={() => onCancel()}
				placeholder={placeholder}
				className="flex-1 min-w-0 bg-transparent outline-none text-base font-medium text-text-1 placeholder:text-text-3"
			/>
		</div>
	);
}

function DocMenu({ model, actions, anchorRef }: DocMenuProps) {
	const t = useT();
	const stateBacked = model.doc.dataModel === "state";
	const copy = async () => {
		await copyToClipboard(model.doc.name);
		actions.close();
	};

	const toggleLock = () => {
		sendLockDoc(model.doc.name, !model.locked);
		actions.close();
	};
	return (
		<AnchoredMenu
			anchorRef={anchorRef}
			onClose={actions.close}
			className="w-48"
			ariaLabel={t("doc_menu")}
		>
			<AnchoredMenuItem icon={<Copy size={13} />} onClick={copy}>
				{t("doc_copy_name")}
			</AnchoredMenuItem>
			<AnchoredMenuItem
				icon={<Pencil size={13} />}
				onClick={actions.rename}
				disabled={model.locked || stateBacked}
			>
				{t("doc_rename")}
			</AnchoredMenuItem>
			<AnchoredMenuItem
				icon={<Files size={13} />}
				onClick={actions.duplicate}
				disabled={stateBacked}
			>
				{t("doc_duplicate")}
			</AnchoredMenuItem>
			<AnchoredMenuItem
				icon={<FolderInput size={13} />}
				onClick={actions.moveCategory}
				disabled={model.locked}
			>
				{t("doc_move_category")}
			</AnchoredMenuItem>
			<AnchoredMenuItem
				icon={<Download size={13} />}
				disabled={stateBacked}
				onClick={() => {
					exportMaketBundle([model.doc.name]);
					actions.close();
				}}
			>
				{t("doc_export_maket")}
			</AnchoredMenuItem>
			<AnchoredMenuItem
				icon={model.locked ? <Unlock size={13} /> : <Lock size={13} />}
				onClick={toggleLock}
			>
				{model.locked ? t("doc_unlock") : t("doc_lock")}
			</AnchoredMenuItem>
			<hr className="my-1 border-0 border-t border-border" />
			<AnchoredMenuItem
				icon={<Trash2 size={13} />}
				onClick={actions.requestDelete}
				disabled={model.locked || !model.canDelete}
				danger
			>
				{t("doc_delete")}
			</AnchoredMenuItem>
		</AnchoredMenu>
	);
}
