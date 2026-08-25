import { ChevronRight } from "lucide-react";

const TREE_INDENT_PX = 16;
const CATEGORY_ROW_START_PX = 8;
const CATEGORY_CHEVRON_SIZE_PX = 24;
const CATEGORY_ROW_GAP_PX = 4;

export interface LibraryCategoryHeaderModel {
	name: string;
	path: string;
	depth: number;
	total: number;
	activeTotal?: number;
	collapsed: boolean;
	dropActive?: boolean;
	toggle: () => void;
	dragOver?: (event: React.DragEvent) => void;
	dragLeave?: (event: React.DragEvent) => void;
	drop?: (event: React.DragEvent) => void;
}

export function LibraryCategoryHeader({
	model,
	toggleLabel,
	countTitle,
	actions,
}: {
	model: LibraryCategoryHeaderModel;
	toggleLabel: string;
	countTitle: string;
	actions?: React.ReactNode;
}) {
	const activeTotal = model.activeTotal ?? 0;
	const dropActive = model.dropActive === true;
	return (
		<div
			onDragOver={model.dragOver}
			onDragLeave={model.dragLeave}
			onDrop={model.drop}
			className={`group/cat relative flex min-h-8 w-full items-center rounded-md transition-colors ${
				dropActive ? "bg-accent/15 ring-2 ring-accent/40" : "hover:bg-input/70"
			}`}
			data-category-path={model.path}
		>
			<button
				type="button"
				onClick={model.toggle}
				className="flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left"
				style={{ paddingLeft: `${libraryCategoryRowOffset(model.depth)}px` }}
				aria-expanded={!model.collapsed}
				aria-label={toggleLabel}
				title={model.path}
			>
				<span
					data-category-content
					className="flex w-fit max-w-full min-w-0 items-center gap-1"
				>
					<span
						data-category-chevron
						className={`grid h-6 w-6 flex-shrink-0 place-items-center transition-colors ${
							dropActive
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
							dropActive ? "text-accent" : "text-text-1"
						}`}
					>
						{model.name}
					</span>
					<span
						data-category-count
						title={countTitle}
						className={`ml-1 inline-flex h-5 min-w-8 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-xs font-semibold leading-none tabular-nums transition-colors ${
							dropActive
								? "bg-accent text-accent-contrast"
								: "bg-input/70 text-text-2 ring-1 ring-inset ring-border/70"
						}`}
					>
						<span data-category-total>{model.total}</span>
						{activeTotal > 0 && (
							<>
								<span
									aria-hidden
									className={
										dropActive ? "text-accent-contrast/70" : "text-text-3"
									}
								>
									/
								</span>
								<span
									data-category-open-count
									className={
										dropActive ? "text-accent-contrast" : "text-accent"
									}
								>
									{activeTotal}
								</span>
							</>
						)}
					</span>
				</span>
			</button>
			{actions}
		</div>
	);
}

export function libraryCategoryRowOffset(depth: number): number {
	return CATEGORY_ROW_START_PX + depth * TREE_INDENT_PX;
}

export function libraryCategoryLabelOffset(depth: number): number {
	return (
		CATEGORY_ROW_START_PX +
		CATEGORY_CHEVRON_SIZE_PX +
		CATEGORY_ROW_GAP_PX +
		depth * TREE_INDENT_PX
	);
}

export function libraryCategoryGuideOffset(depth: number): number {
	return (
		CATEGORY_ROW_START_PX +
		CATEGORY_CHEVRON_SIZE_PX / 2 +
		depth * TREE_INDENT_PX
	);
}
