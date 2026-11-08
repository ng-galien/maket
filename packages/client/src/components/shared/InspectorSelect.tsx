import { Check, ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { AnchoredMenu } from "./AnchoredMenu";

/** Compact select using the same menu, focus and dismissal as workspace actions. */
export function InspectorSelect({
	label,
	value,
	options,
	disabled,
	onChange,
}: {
	label: string;
	value: string;
	options: Array<{ value: string; label: string; disabled?: boolean }>;
	disabled?: boolean;
	onChange: (value: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const id = useId();
	const selected = options.find((option) => option.value === value);
	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				role="combobox"
				aria-label={label}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? id : undefined}
				disabled={disabled}
				onClick={() => setOpen(!open)}
				onKeyDown={(event) => {
					if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
						event.preventDefault();
						setOpen(true);
					}
				}}
				className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md bg-input px-3 text-left text-sm text-text-1 transition-colors hover:bg-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
			>
				<span className="min-w-0 flex-1 truncate">
					{selected?.label ?? value}
				</span>
				<ChevronDown
					size={14}
					strokeWidth={1.65}
					className="shrink-0 text-text-2"
					aria-hidden="true"
				/>
			</button>
			{open && (
				<AnchoredMenu
					anchorRef={anchorRef}
					onClose={() => setOpen(false)}
					role="listbox"
					id={id}
					ariaLabel={label}
					align="start"
					className="max-h-72 overflow-y-auto min-w-32"
				>
					<div
						data-inspector-select-menu
						style={{ width: anchorRef.current?.getBoundingClientRect().width }}
					>
						{options.map((option) => (
							<button
								key={option.value}
								type="button"
								role="option"
								tabIndex={-1}
								aria-selected={value === option.value}
								disabled={option.disabled}
								onClick={() => {
									setOpen(false);
									onChange(option.value);
								}}
								className="flex h-8 w-full items-center gap-2 px-3 text-left text-sm text-text-1 outline-none hover:bg-input focus:bg-input disabled:opacity-40"
							>
								<span className="min-w-0 flex-1 truncate">{option.label}</span>
								{value === option.value && (
									<Check
										size={14}
										strokeWidth={1.65}
										className="shrink-0 text-accent"
										aria-hidden="true"
									/>
								)}
							</button>
						))}
					</div>
				</AnchoredMenu>
			)}
		</>
	);
}
