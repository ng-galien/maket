import { FolderInput, MoreVertical, Pencil } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n/useT";
import { InlineNameEditor } from "./DocMenu";
import type { DocsCategoryModel } from "./types";

export function CategoryMenuButton({
	model,
	anchorRef,
}: {
	model: DocsCategoryModel;
	anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
	const t = useT();
	return (
		<button
			ref={anchorRef}
			type="button"
			aria-label={t("category_menu", { category: model.path })}
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
	model: DocsCategoryModel;
	anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
	const t = useT();
	const menuRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

	useLayoutEffect(() => {
		if (!model.menuOpen || !anchorRef.current) return;
		const rect = anchorRef.current.getBoundingClientRect();
		const height = 86;
		const top =
			rect.bottom + 4 + height > window.innerHeight
				? Math.max(8, rect.top - height - 4)
				: rect.bottom + 4;
		setPos({ top, right: Math.max(8, window.innerWidth - rect.right) });
	}, [anchorRef, model.menuOpen]);

	useEffect(() => {
		if (!model.menuOpen) return;
		const onPointerDown = (event: MouseEvent) => {
			if (menuRef.current?.contains(event.target as Node)) return;
			if (anchorRef.current?.contains(event.target as Node)) return;
			model.closeMenu();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") model.closeMenu();
		};
		const onScroll = () => model.closeMenu();
		document.addEventListener("mousedown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onScroll);
		return () => {
			document.removeEventListener("mousedown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onScroll);
		};
	}, [anchorRef, model]);

	if (!model.menuOpen || !pos) return null;
	return createPortal(
		<div
			ref={menuRef}
			className="fixed z-[210] w-52 overflow-hidden rounded-md border border-border bg-panel py-1 shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
			style={pos}
		>
			<button
				type="button"
				onClick={model.startRename}
				className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text-1 hover:bg-input"
			>
				<Pencil size={14} />
				<span>{t("category_rename")}</span>
			</button>
			<button
				type="button"
				onClick={model.startMove}
				className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text-1 hover:bg-input"
			>
				<FolderInput size={14} />
				<span>{t("category_move")}</span>
			</button>
		</div>,
		document.body,
	);
}

export function CategoryInlineRename({ model }: { model: DocsCategoryModel }) {
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
