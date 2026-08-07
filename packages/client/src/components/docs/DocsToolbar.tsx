import { LayoutGrid, List, Search, Upload } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n/useT";
import {
	applySearchSuggestion,
	buildQueryChips,
	buildSearchSuggestions,
	type SearchSuggestion,
} from "./docsQuery";
import type { DocsToolbarModel, Query, QueryChip, View } from "./types";

export interface ToolbarFactoryArgs {
	search: string;
	setSearch: (value: string) => void;
	categories: string[];
	query: Query;
	view: View;
	setView: (view: View) => void;
	importState: {
		importInputRef: React.RefObject<HTMLInputElement | null>;
		importError: string | null;
		importDrag: boolean;
		setImportError: (v: string | null) => void;
		setImportDrag: (v: boolean) => void;
		handleImportFile: (file: File) => Promise<void>;
	};
}

export function createToolbarModel(args: ToolbarFactoryArgs): DocsToolbarModel {
	const { importState } = args;
	return {
		search: args.search,
		setSearch: args.setSearch,
		categories: args.categories,
		chips: buildQueryChips(args.query, args.search, args.setSearch),
		importInputRef: importState.importInputRef,
		importError: importState.importError,
		importDrag: importState.importDrag,
		clearImportError: () => importState.setImportError(null),
		startImport: () => importState.importInputRef.current?.click(),
		handleImportInput: (event) => {
			const file = event.target.files?.[0];
			if (file) void importState.handleImportFile(file);
			event.target.value = "";
		},
		handleImportDragOver: (event) => {
			if (!event.dataTransfer.types.includes("Files")) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
			if (!importState.importDrag) importState.setImportDrag(true);
		},
		handleImportDragLeave: () => importState.setImportDrag(false),
		handleImportDrop: (event) => handleImportDrop(event, importState),
		view: args.view,
		setView: args.setView,
	};
}

function handleImportDrop(
	event: React.DragEvent,
	importState: ToolbarFactoryArgs["importState"],
) {
	event.preventDefault();
	importState.setImportDrag(false);
	const file = Array.from(event.dataTransfer.files).find((item) =>
		item.name.toLowerCase().endsWith(".maket"),
	);
	if (file) void importState.handleImportFile(file);
	else importState.setImportError("Import failed: .maket");
}

export function DocsToolbar({ model }: { model: DocsToolbarModel }) {
	return (
		<div className="px-1 flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5">
				<DocsSearch model={model} />
				<input
					ref={model.importInputRef}
					type="file"
					accept=".maket"
					className="hidden"
					onChange={model.handleImportInput}
				/>
				<ImportButton model={model} />
				<ViewToggle view={model.view} setView={model.setView} />
			</div>
			{model.importError && (
				<button
					type="button"
					onClick={model.clearImportError}
					className="text-left text-2xs text-danger bg-danger-soft rounded-md px-2 py-1"
				>
					{model.importError} ×
				</button>
			)}
			<QueryChips chips={model.chips} />
		</div>
	);
}

function DocsSearch({ model }: { model: DocsToolbarModel }) {
	const t = useT();
	const inputRef = useRef<HTMLInputElement>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const [dismissedSearch, setDismissedSearch] = useState<string | null>(null);
	const suggestions = buildSearchSuggestions(model.search, model.categories);
	const open = suggestions.length > 0 && dismissedSearch !== model.search;
	const position = useSuggestionPosition(
		inputRef,
		open,
		model.search,
		suggestions.length,
	);
	const commit = (suggestion: SearchSuggestion) => {
		model.setSearch(applySearchSuggestion(model.search, suggestion));
		setActiveIndex(0);
		setDismissedSearch(null);
		requestAnimationFrame(() => inputRef.current?.focus());
	};
	return (
		<div className="relative flex-1 min-w-0">
			<Search
				size={12}
				aria-hidden
				className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none"
			/>
			<input
				ref={inputRef}
				value={model.search}
				onChange={(event) => {
					model.setSearch(event.target.value);
					setActiveIndex(0);
					setDismissedSearch(null);
				}}
				onFocus={() => setDismissedSearch(null)}
				onBlur={() => setDismissedSearch(model.search)}
				onKeyDown={(event) =>
					handleSearchKeyDown(event, {
						open,
						suggestions,
						activeIndex,
						setActiveIndex,
						commit,
						dismiss: () => setDismissedSearch(model.search),
					})
				}
				placeholder={t("search_hint")}
				role="combobox"
				aria-autocomplete="list"
				aria-expanded={open}
				aria-controls="docs-search-suggestions"
				aria-activedescendant={
					open ? `docs-search-suggestion-${activeIndex}` : undefined
				}
				autoComplete="off"
				className="w-full min-w-0 h-7 pl-8 pr-3 bg-input rounded-md text-sm outline-none placeholder:text-text-3 focus:ring-2 focus:ring-accent/20"
			/>
			{open && position
				? createPortal(
						<SearchSuggestionList
							suggestions={suggestions}
							activeIndex={activeIndex}
							setActiveIndex={setActiveIndex}
							commit={commit}
							position={position}
						/>,
						document.body,
					)
				: null}
		</div>
	);
}

interface SearchKeyboardContext {
	open: boolean;
	suggestions: SearchSuggestion[];
	activeIndex: number;
	setActiveIndex: (index: number) => void;
	commit: (suggestion: SearchSuggestion) => void;
	dismiss: () => void;
}

function handleSearchKeyDown(
	event: React.KeyboardEvent<HTMLInputElement>,
	context: SearchKeyboardContext,
) {
	if (!context.open) return;
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		const direction = event.key === "ArrowDown" ? 1 : -1;
		context.setActiveIndex(
			(context.activeIndex + direction + context.suggestions.length) %
				context.suggestions.length,
		);
		return;
	}
	if (event.key === "Enter" || event.key === "Tab") {
		const suggestion = context.suggestions[context.activeIndex];
		if (!suggestion) return;
		event.preventDefault();
		context.commit(suggestion);
		return;
	}
	if (event.key === "Escape") {
		event.preventDefault();
		context.dismiss();
	}
}

function useSuggestionPosition(
	inputRef: React.RefObject<HTMLInputElement | null>,
	open: boolean,
	search: string,
	suggestionCount: number,
) {
	const [position, setPosition] = useState<{
		top: number;
		left: number;
		width: number;
	} | null>(null);
	useLayoutEffect(() => {
		if (!open || !inputRef.current) {
			setPosition(null);
			return;
		}
		const input = inputRef.current;
		const update = () => {
			const rect = input.getBoundingClientRect();
			const estimatedHeight = Math.min(240, suggestionCount * 36 + 36);
			const opensBelow =
				rect.bottom + estimatedHeight + 12 <= window.innerHeight;
			setPosition({
				top: opensBelow
					? rect.bottom + 4
					: Math.max(8, rect.top - estimatedHeight - 4),
				left: rect.left,
				width: rect.width,
			});
		};
		update();
		const observer =
			typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
		observer?.observe(input);
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
		};
	}, [inputRef, open, search, suggestionCount]);
	return position;
}

function SearchSuggestionList({
	suggestions,
	activeIndex,
	setActiveIndex,
	commit,
	position,
}: {
	suggestions: SearchSuggestion[];
	activeIndex: number;
	setActiveIndex: (index: number) => void;
	commit: (suggestion: SearchSuggestion) => void;
	position: { top: number; left: number; width: number };
}) {
	const t = useT();
	return (
		<div
			id="docs-search-suggestions"
			role="listbox"
			className="fixed z-[var(--z-modal)] max-h-60 overflow-y-auto rounded-lg border border-border bg-panel p-1 shadow-[0_14px_40px_rgba(0,0,0,0.16)]"
			style={{
				...position,
				animation: "popoverIn 140ms cubic-bezier(0.16, 1, 0.3, 1)",
			}}
		>
			{suggestions.map((suggestion, index) => (
				<button
					key={suggestion.id}
					id={`docs-search-suggestion-${index}`}
					type="button"
					role="option"
					aria-selected={index === activeIndex}
					onMouseEnter={() => setActiveIndex(index)}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => commit(suggestion)}
					className={`w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
						index === activeIndex
							? "bg-accent/10 text-text-1"
							: "text-text-2 hover:bg-black/[0.04]"
					}`}
				>
					<span className="font-mono text-xs font-semibold truncate">
						{suggestion.token}
					</span>
					<span className="ml-auto text-2xs text-text-3">
						{t(`search_suggestion_${suggestion.kind}`)}
					</span>
				</button>
			))}
			<div className="px-2.5 py-1.5 text-2xs text-text-3 border-t border-border mt-1">
				{t("search_suggestion_keys")}
			</div>
		</div>
	);
}

function ImportButton({ model }: { model: DocsToolbarModel }) {
	const t = useT();
	return (
		<button
			type="button"
			onClick={model.startImport}
			onDragOver={model.handleImportDragOver}
			onDragLeave={model.handleImportDragLeave}
			onDrop={model.handleImportDrop}
			aria-label={t("import_maket")}
			title={t("import_maket")}
			className={`w-7 h-7 rounded-md flex items-center justify-center transition ${
				model.importDrag
					? "bg-accent-soft text-accent ring-2 ring-accent/40"
					: "bg-input text-text-3 hover:text-text-1"
			}`}
		>
			<Upload size={13} />
		</button>
	);
}

function ViewToggle({
	view,
	setView,
}: {
	view: View;
	setView: (view: View) => void;
}) {
	const t = useT();
	return (
		<div className="flex rounded-md bg-input p-0.5">
			<ViewToggleButton
				active={view === "list"}
				label={t("view_list")}
				onClick={() => setView("list")}
				icon={<List size={13} />}
			/>
			<ViewToggleButton
				active={view === "grid"}
				label={t("view_grid")}
				onClick={() => setView("grid")}
				icon={<LayoutGrid size={13} />}
			/>
		</div>
	);
}

function ViewToggleButton({
	active,
	label,
	onClick,
	icon,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
	icon: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className={`w-7 h-7 rounded-[5px] flex items-center justify-center transition ${
				active
					? "bg-panel shadow-sm text-text-1"
					: "text-text-3 hover:text-text-1"
			}`}
		>
			{icon}
		</button>
	);
}

function QueryChips({ chips }: { chips: QueryChip[] }) {
	if (chips.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1 px-1">
			{chips.map((chip) => (
				<button
					key={chip.key}
					type="button"
					onClick={chip.onRemove}
					className="group flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-2xs font-semibold hover:bg-accent/15 transition"
				>
					<span>{chip.label}</span>
					<span
						aria-hidden
						className="opacity-60 group-hover:opacity-100 leading-none"
					>
						×
					</span>
				</button>
			))}
		</div>
	);
}
