import { useStore } from "../store/useStore";

interface Props {
	open: boolean;
	onClose: () => void;
	side?: "left" | "right";
	children: React.ReactNode;
}

export function SidePanel({ open, onClose, side = "left", children }: Props) {
	const barPosition = useStore((s) => s.barPosition);

	const barSide = 68;
	const freeSide = 8;
	// Panel anchored to bar side, max height but not forced full height
	const panelStyle =
		barPosition === "top"
			? { top: barSide, maxHeight: `calc(100vh - ${barSide + freeSide}px)` }
			: { bottom: barSide, maxHeight: `calc(100vh - ${barSide + freeSide}px)` };

	const sideClass =
		side === "left"
			? `left-0 rounded-r-xl ${open ? "translate-x-0" : "-translate-x-full"}`
			: `right-0 rounded-l-xl ${open ? "translate-x-0" : "translate-x-full"}`;

	return (
		<>
			{open && (
				<div
					role="button"
					tabIndex={-1}
					onKeyDown={(e) => {
						if (e.key === "Escape") onClose();
					}}
					className="fixed inset-0 bg-black/8 z-[200]"
					onClick={onClose}
				/>
			)}

			<aside
				style={panelStyle}
				className={`fixed w-[90vw] sm:w-[50vw] md:w-[33vw] bg-panel border border-border shadow-[0_20px_60px_rgba(0,0,0,0.15)] z-[201] flex flex-col overflow-hidden transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] rounded-xl ${sideClass}`}
			>
				<div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-border">
					{children}
				</div>
			</aside>
		</>
	);
}
