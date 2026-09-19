interface SegmentedControlOption<Value extends string> {
	value: Value;
	label: string;
	icon: React.ReactNode;
}

export function SegmentedControl<Value extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: Value;
	options: readonly SegmentedControlOption<Value>[];
	onChange: (value: Value) => void;
}) {
	return (
		<div
			role="group"
			aria-label={label}
			className="flex shrink-0 items-center rounded bg-input p-0.5"
		>
			{options.map((option) => {
				const active = option.value === value;
				return (
					<button
						key={option.value}
						type="button"
						aria-pressed={active}
						aria-label={option.label}
						title={option.label}
						onClick={() => onChange(option.value)}
						className={`flex h-7 items-center gap-1.5 rounded-[2px] px-2 text-2xs font-semibold transition-colors ${
							active
								? "bg-panel text-accent shadow-xs"
								: "text-text-3 hover:text-text-1"
						}`}
					>
						{option.icon}
						<span className="max-[1100px]:sr-only">{option.label}</span>
					</button>
				);
			})}
		</div>
	);
}
