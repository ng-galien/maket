import { normalizeCategoryPath } from "@maket/shared";
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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n/useT";
import {
	sendDeleteDoc,
	sendDuplicateDoc,
	sendLockDoc,
	sendRenameDoc,
	wsSend,
} from "../../store/ws";
import { copyToClipboard } from "../../utils";
import { HoldToDelete } from "../shared/HoldToDelete";
import { exportMaketBundle } from "./docsImportExport";
import type {
	DocItemActions,
	DocItemMenuProps,
	DocItemModel,
	DocItemProps,
	DocMenuActions,
	DocMenuModel,
	DocMenuProps,
	DocMenuViewModel,
	DocRowMenuButtonProps,
	InlineNameEditorProps,
	MenuItemProps,
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
	const rowPosition = "absolute right-1.5 top-1/2 -translate-y-1/2";
	const buttonSize = size === "card" ? "w-6 h-6" : `w-7 h-7 ${rowPosition}`;
	const hover =
		size === "card"
			? "group-hover/card:opacity-100"
			: "group-hover:opacity-100";
	return (
		<button
			ref={anchorRef}
			type="button"
			aria-label={t("doc_menu")}
			onClick={(event) => toggleDocMenu(event, model, actions)}
			className={`${buttonSize} rounded-md flex items-center justify-center text-text-3 hover:bg-black/[0.06] transition ${
				model.menuOpen
					? "bg-black/[0.06]"
					: `opacity-0 ${hover} focus:opacity-100`
			}`}
		>
			<MoreVertical size={size === "card" ? 13 : 14} />
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

export function DocInlineCategoryEditor({ model, actions }: DocItemProps) {
	const t = useT();
	return (
		<InlineNameEditor
			initial={model.doc.category || "general"}
			placeholder={t("doc_move_category_prompt")}
			onCommit={(value) => {
				const raw = value.trim();
				actions.changeMode({ kind: "idle" });
				if (!raw) return;
				const category = normalizeCategoryPath(raw);
				if (category !== normalizeCategoryPath(model.doc.category)) {
					wsSend({ type: "update_meta", docName: model.doc.name, category });
				}
			}}
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
				moveCategory: () => changeDocMenuMode(actions, "move-category"),
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
	const menu = useDocMenuModel(model, actions, anchorRef);
	if (!menu.pos) return null;
	return createPortal(<DocMenuView menu={menu} />, document.body);
}

function useDocMenuModel(
	model: DocMenuModel,
	actions: DocMenuActions,
	anchorRef: React.RefObject<HTMLElement | null>,
): DocMenuViewModel {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

	useLayoutEffect(() => {
		const a = anchorRef.current;
		if (!a) return;
		const rect = a.getBoundingClientRect();
		const MENU_W = 192;
		const GAP = 4;
		const top = rect.bottom + GAP;
		const right = Math.max(8, window.innerWidth - rect.right);
		const ESTIMATED_H = 238;
		const flipped =
			top + ESTIMATED_H > window.innerHeight - 8
				? Math.max(8, rect.top - GAP - ESTIMATED_H)
				: top;
		void MENU_W;
		setPos({ top: flipped, right });
	}, [anchorRef]);

	useEffect(() => {
		const onDocClick = (e: MouseEvent) => {
			if (ref.current?.contains(e.target as Node)) return;
			if (anchorRef.current?.contains(e.target as Node)) return;
			actions.close();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") actions.close();
		};
		const onScroll = () => actions.close();
		document.addEventListener("mousedown", onDocClick);
		document.addEventListener("keydown", onKey);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onScroll);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onScroll);
		};
	}, [actions, anchorRef]);

	const copy = async () => {
		await copyToClipboard(model.doc.name);
		actions.close();
	};

	const toggleLock = () => {
		sendLockDoc(model.doc.name, !model.locked);
		actions.close();
	};

	return { ...model, ref, pos, actions, copy, toggleLock };
}

// code-moniker: ignore[smell-feature-envy-local]
// Pure React view: composing menu items is the component's adapter role, not misplaced domain behavior.
function DocMenuView({ menu }: { menu: DocMenuViewModel }) {
	const t = useT();
	const stateBacked = menu.doc.dataModel === "state";
	return (
		<div
			ref={menu.ref}
			className="fixed z-[210] w-48 bg-panel rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.18)] border border-black/5 overflow-hidden py-1"
			style={{ top: menu.pos?.top, right: menu.pos?.right }}
		>
			<MenuItem icon={<Copy size={13} />} onClick={menu.copy}>
				{t("doc_copy_name")}
			</MenuItem>
			<MenuItem
				icon={<Pencil size={13} />}
				onClick={menu.actions.rename}
				disabled={menu.locked || stateBacked}
			>
				{t("doc_rename")}
			</MenuItem>
			<MenuItem
				icon={<Files size={13} />}
				onClick={menu.actions.duplicate}
				disabled={stateBacked}
			>
				{t("doc_duplicate")}
			</MenuItem>
			<MenuItem
				icon={<FolderInput size={13} />}
				onClick={menu.actions.moveCategory}
				disabled={menu.locked}
			>
				{t("doc_move_category")}
			</MenuItem>
			<MenuItem
				icon={<Download size={13} />}
				disabled={stateBacked}
				onClick={() => {
					exportMaketBundle([menu.doc.name]);
					menu.actions.close();
				}}
			>
				{t("doc_export_maket")}
			</MenuItem>
			<MenuItem
				icon={menu.locked ? <Unlock size={13} /> : <Lock size={13} />}
				onClick={menu.toggleLock}
			>
				{menu.locked ? t("doc_unlock") : t("doc_lock")}
			</MenuItem>
			<div className="h-px bg-black/[0.06] my-1" />
			<MenuItem
				icon={<Trash2 size={13} />}
				onClick={menu.actions.requestDelete}
				disabled={menu.locked || !menu.canDelete}
				danger
			>
				{t("doc_delete")}
			</MenuItem>
		</div>
	);
}

function MenuItem({
	icon,
	children,
	onClick,
	disabled,
	danger,
}: MenuItemProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition ${
				disabled
					? "text-text-3 cursor-not-allowed"
					: danger
						? "text-danger hover:bg-danger-soft"
						: "text-text-1 hover:bg-black/[0.05]"
			}`}
		>
			<span className="flex-shrink-0">{icon}</span>
			<span className="flex-1 truncate">{children}</span>
		</button>
	);
}
