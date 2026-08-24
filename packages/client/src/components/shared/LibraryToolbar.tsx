import type { ReactNode } from "react";

interface LibraryToolbarProps {
	children: ReactNode;
}

/** Stable frame shared by every left-library control bar. */
export function LibraryToolbar({ children }: LibraryToolbarProps) {
	return (
		<div
			data-library-toolbar
			className="shrink-0 border-b border-border bg-panel px-2.5 py-2"
		>
			{children}
		</div>
	);
}

/** Shared first row: all library searches and adjacent controls align here. */
export function LibraryToolbarRow({ children }: LibraryToolbarProps) {
	return (
		<div data-library-toolbar-row className="flex min-h-8 items-center gap-1.5">
			{children}
		</div>
	);
}

/** Natural-width trailing slot lets the search field fill the remaining space. */
export function LibraryToolbarActions({ children }: LibraryToolbarProps) {
	return (
		<div
			data-library-toolbar-actions
			className="flex shrink-0 items-center justify-end gap-1.5"
		>
			{children}
		</div>
	);
}
