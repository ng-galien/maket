export function ResizeHandleFeedback({
	orientation,
	active,
}: {
	orientation: "horizontal" | "vertical";
	active: boolean;
}) {
	const vertical = orientation === "vertical";
	return (
		<>
			<span
				data-resize-guide
				aria-hidden="true"
				className={`pointer-events-none absolute transition-[width,height,background-color,opacity] duration-150 ${
					vertical
						? "inset-y-0 left-1/2 -translate-x-1/2"
						: "inset-x-0 top-1/2 -translate-y-1/2"
				} ${active ? `${vertical ? "w-[3px]" : "h-[3px]"} bg-accent/35 opacity-100` : `${vertical ? "w-px" : "h-px"} bg-accent/15 opacity-0`}`}
			/>
			<span
				data-resize-grip
				aria-hidden="true"
				className={`relative rounded-full transition-[height,width,background-color,box-shadow] duration-150 ${
					vertical
						? active
							? "h-16 w-[5px] bg-accent/80 shadow-[0_0_8px_var(--color-accent-soft)]"
							: "h-9 w-px bg-text-3/45 group-hover/resize:h-12 group-hover/resize:bg-accent/50 group-focus-visible/resize:h-12 group-focus-visible/resize:bg-accent/50"
						: active
							? "h-[5px] w-16 bg-accent/80 shadow-[0_0_8px_var(--color-accent-soft)]"
							: "h-px w-12 bg-text-3/45 group-hover/resize:w-16 group-hover/resize:bg-accent/50 group-focus-visible/resize:w-16 group-focus-visible/resize:bg-accent/50"
				}`}
			/>
		</>
	);
}
