import { LayoutGrid, List } from "lucide-react";

interface LibraryViewToggleProps {
	view: "list" | "grid";
	onChange: (view: "list" | "grid") => void;
	listLabel: string;
	gridLabel: string;
}

export function LibraryViewToggle({
	view,
	onChange,
	listLabel,
	gridLabel,
}: LibraryViewToggleProps) {
	return (
		<div className="flex rounded-md bg-input p-0.5">
			<ViewToggleButton
				active={view === "list"}
				label={listLabel}
				onClick={() => onChange("list")}
				icon={<List size={14} />}
			/>
			<ViewToggleButton
				active={view === "grid"}
				label={gridLabel}
				onClick={() => onChange("grid")}
				icon={<LayoutGrid size={14} />}
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
			className={`flex h-7 w-7 items-center justify-center rounded-[5px] transition ${
				active
					? "bg-panel shadow-sm text-text-1"
					: "text-text-3 hover:text-text-1"
			}`}
		>
			{icon}
		</button>
	);
}
