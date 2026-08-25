import { normalizeCategoryPath } from "@maket/shared";
import {
	ChevronRight,
	ImageIcon,
	MoveRight,
	Plus,
	Search,
	X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n/useT";
import { useModalFocusTrap } from "../shared/useModalFocusTrap";
import type { CategoryPickerModel } from "./types";

export function CategoryPicker({ model }: { model: CategoryPickerModel }) {
	const t = useT();
	const target = model.target;
	const inputRef = useRef<HTMLInputElement>(null);
	const dialogRef = useRef<HTMLElement>(null);
	const listboxId = useId();
	const [value, setValue] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);

	useEffect(() => {
		if (!target) return;
		setValue("");
		setActiveIndex(0);
		setSelectedPath(null);
	}, [target]);
	useModalFocusTrap({
		open: Boolean(target),
		containerRef: dialogRef,
		initialFocusRef: inputRef,
		onEscape: model.close,
	});

	const normalized = value.trim() ? normalizeCategoryPath(value) : "";
	const options = useMemo(() => {
		if (!target) return [];
		const currentDestination = currentCategoryDestination(target);
		const needle = value.trim().toLocaleLowerCase();
		const existing = model.categories
			.filter((path) => {
				if (target.kind !== "category") return path !== target.category;
				return path !== target.path && !path.startsWith(`${target.path}/`);
			})
			.filter((path) => !needle || path.toLocaleLowerCase().includes(needle))
			.map((path) => ({
				path,
				depth: path.split("/").length - 1,
				create: false,
				disabled: path === currentDestination,
			}));
		const items = [...existing];
		if (!value.trim()) {
			items.unshift({
				path: "",
				depth: 0,
				create: false,
				disabled: rootIsCurrentDestination(target, currentDestination),
			});
		}
		if (normalized && !existing.some((option) => option.path === normalized)) {
			items.unshift({
				path: normalized,
				depth: normalized.split("/").length - 1,
				create: true,
				disabled: normalized === currentDestination,
			});
		}
		return items;
	}, [model.categories, normalized, target, value]);

	if (!target) return null;

	const title = categoryPickerTitle(target, t);
	const dialogWidth = categoryPickerWidth(model.categories);
	const selectActiveOption = () => {
		const active = options[activeIndex];
		if (active && !active.disabled) setSelectedPath(active.path);
	};

	return createPortal(
		<div
			className="fixed inset-0 z-[230] flex items-start justify-center bg-black/20 px-4 pt-[12vh]"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) model.close();
			}}
		>
			<section
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				tabIndex={-1}
				className="flex max-h-[min(68vh,620px)] flex-col overflow-hidden rounded-md border border-border bg-panel shadow-[0_18px_55px_rgba(0,0,0,0.22)]"
				style={{ width: `min(92vw, ${dialogWidth}px)` }}
			>
				<header className="flex shrink-0 items-center gap-3 border-b border-accent/40 px-4 py-3">
					<span className="grid h-8 w-8 shrink-0 place-items-center text-accent">
						{target.kind === "asset" ? (
							<ImageIcon size={17} />
						) : (
							<MoveRight size={18} />
						)}
					</span>
					<div className="min-w-0 flex-1">
						<h2 className="truncate text-lg font-semibold text-text-1">
							{title}
						</h2>
						<p className="truncate text-sm text-text-3">
							{target.kind === "asset"
								? target.name
								: target.kind === "category"
									? t("move_category_parent_hint")
									: t("move_document_hint")}
						</p>
					</div>
					<button
						type="button"
						onClick={model.close}
						aria-label={t("close")}
						className="grid h-9 w-9 place-items-center rounded-md text-text-3 hover:bg-input hover:text-text-1"
					>
						<X size={17} />
					</button>
				</header>

				<div className="shrink-0 px-4 py-3">
					<div className="flex h-10 items-center gap-2.5 rounded-md border border-border bg-input/80 px-3 focus-within:border-accent">
						<Search size={17} className="shrink-0 text-text-3" />
						<input
							ref={inputRef}
							role="combobox"
							aria-controls={listboxId}
							aria-expanded
							aria-activedescendant={
								options[activeIndex] ? `${listboxId}-${activeIndex}` : undefined
							}
							value={value}
							onChange={(event) => {
								setValue(event.target.value);
								setActiveIndex(0);
								setSelectedPath(null);
							}}
							onKeyDown={(event) => {
								if (event.key === "ArrowDown") {
									event.preventDefault();
									setActiveIndex((index) =>
										Math.min(index + 1, Math.max(0, options.length - 1)),
									);
								} else if (event.key === "ArrowUp") {
									event.preventDefault();
									setActiveIndex((index) => Math.max(0, index - 1));
								} else if (event.key === "Enter") {
									event.preventDefault();
									selectActiveOption();
								}
							}}
							placeholder={t("move_category_search_placeholder")}
							aria-label={t("move_category_search_placeholder")}
							className="category-picker-search-input min-w-0 flex-1 bg-transparent text-base text-text-1 placeholder:text-text-3"
						/>
					</div>
				</div>

				<div
					id={listboxId}
					role="listbox"
					className="min-h-0 flex-1 overflow-y-auto border-t border-border px-2 py-2"
				>
					{options.map((option, index) => (
						<div
							key={option.path}
							className={`group/destination flex min-h-9 w-full items-center rounded-md ${
								selectedPath === option.path
									? "bg-accent/10"
									: activeIndex === index
										? "bg-input/80"
										: "hover:bg-input/60"
							}`}
						>
							<button
								id={`${listboxId}-${index}`}
								type="button"
								role="option"
								aria-selected={selectedPath === option.path}
								aria-disabled={option.disabled}
								disabled={option.disabled}
								aria-label={option.path || t("category_root")}
								onPointerMove={() => setActiveIndex(index)}
								onClick={() => setSelectedPath(option.path)}
								className={`flex min-w-0 items-center gap-2 px-3 py-2 text-left text-base text-text-1 ${
									selectedPath === option.path
										? "max-w-[calc(100%-5.5rem)]"
										: "flex-1"
								} disabled:cursor-default disabled:text-text-3`}
							>
								<span
									className="flex shrink-0 items-center text-text-3"
									style={{ marginLeft: `${Math.min(option.depth, 5) * 14}px` }}
								>
									{option.create ? (
										<Plus size={14} />
									) : (
										<ChevronRight size={14} />
									)}
								</span>
								<span
									className="min-w-0 flex-1 truncate"
									title={option.path || t("category_root")}
								>
									{categoryLeaf(option.path) || t("category_root")}
								</span>
							</button>
							{selectedPath === option.path && (
								<button
									type="button"
									onClick={() => model.moveTo(option.path)}
									aria-label={t("move_category_confirm", {
										path:
											moveResultPath(target, option.path) || t("category_root"),
									})}
									className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-sm font-medium text-accent hover:bg-accent/10"
								>
									<ChevronRight size={13} strokeWidth={2.5} />
									<span>{t("move_category_action")}</span>
								</button>
							)}
						</div>
					))}
					{options.length === 0 && (
						<p className="px-3 py-8 text-center text-sm text-text-3">
							{t("move_category_no_destination")}
						</p>
					)}
				</div>
			</section>
		</div>,
		document.body,
	);
}

function categoryLeaf(path: string): string {
	return path.split("/").filter(Boolean).at(-1) ?? "";
}

function currentCategoryDestination(
	target: NonNullable<CategoryPickerModel["target"]>,
): string {
	if (target.kind !== "category") return normalizeCategoryPath(target.category);
	return target.path.split("/").slice(0, -1).join("/");
}

function rootIsCurrentDestination(
	target: NonNullable<CategoryPickerModel["target"]>,
	currentDestination: string,
): boolean {
	return target.kind === "category"
		? currentDestination === ""
		: currentDestination === normalizeCategoryPath("");
}

function categoryPickerTitle(
	target: NonNullable<CategoryPickerModel["target"]>,
	t: ReturnType<typeof useT>,
): string {
	if (target.kind === "category")
		return t("move_category_title", { name: target.path });
	if (target.kind === "asset") return t("move_photo_title");
	return t("move_document_title", { name: target.name });
}

function categoryPickerWidth(categories: string[]) {
	const longestPath = categories.reduce(
		(longest, path) => Math.max(longest, path.length),
		0,
	);
	return Math.min(560, Math.max(430, 140 + longestPath * 6.5));
}

function moveResultPath(
	target: NonNullable<CategoryPickerModel["target"]>,
	destination: string,
) {
	if (target.kind !== "category") return destination;
	const leaf = target.path.split("/").at(-1) ?? target.path;
	return destination ? `${destination}/${leaf}` : leaf;
}
