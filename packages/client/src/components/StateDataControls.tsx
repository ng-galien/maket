import { Code2, Eye, History } from "lucide-react";
import { useT } from "../i18n/useT";
import { useFocusedDoc, useStore } from "../store/useStore";

export function StateDockButton() {
	const t = useT();
	const focusedDoc = useFocusedDoc();
	const open = useStore((state) => state.stateDockOpen);
	const setOpen = useStore((state) => state.setStateDockOpen);
	if (focusedDoc?.dataModel !== "state") return null;
	return (
		<button
			type="button"
			data-state-dock-trigger
			aria-label={t("state_open_data")}
			title={t("state_open_data")}
			aria-pressed={open}
			onClick={() => setOpen(!open)}
			className={`relative -ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm transition-colors ${
				open
					? "bg-accent-soft/70 text-accent"
					: "text-text-3 hover:bg-input/70 hover:text-text-1"
			}`}
		>
			<History size={15} strokeWidth={1.6} />
		</button>
	);
}

export function StateRenderControls() {
	const t = useT();
	const focusedDoc = useFocusedDoc();
	const mode = useStore((state) =>
		focusedDoc ? (state.stateCanvasModes[focusedDoc.name] ?? "live") : "live",
	);
	const setMode = useStore((state) => state.setStateCanvasMode);
	if (focusedDoc?.dataModel !== "state") return null;
	return (
		<div
			role="group"
			aria-label={t("state_render_mode")}
			className="flex shrink-0 items-center rounded bg-input p-0.5"
		>
			<StateModeButton
				active={mode === "live"}
				label={t("state_live_mode")}
				onClick={() => setMode(focusedDoc.name, "live")}
				icon={<Eye size={14} />}
			/>
			<StateModeButton
				active={mode === "design"}
				label={t("state_design_mode")}
				onClick={() => setMode(focusedDoc.name, "design")}
				icon={<Code2 size={14} />}
			/>
		</div>
	);
}

function StateModeButton({
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
			aria-pressed={active}
			aria-label={label}
			title={label}
			onClick={onClick}
			className={`flex h-7 items-center gap-1.5 rounded-[2px] px-2 text-2xs font-semibold transition-colors ${
				active
					? "bg-panel text-accent shadow-xs"
					: "text-text-3 hover:text-text-1"
			}`}
		>
			{icon}
			<span>{label}</span>
		</button>
	);
}
