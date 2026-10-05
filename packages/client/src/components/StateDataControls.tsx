import { Code2, Eye, History } from "lucide-react";
import { useT } from "../i18n/useT";
import { useFocusedDoc, useStore } from "../store/useStore";
import { SegmentedControl } from "./shared/SegmentedControl";

export function StateDockButton() {
	const t = useT();
	const focusedDoc = useFocusedDoc();
	const template = useStore((state) =>
		state.structuredWorkspaces.some((workspace) =>
			workspace.templateDocuments.some(
				(document) => document.documentName === focusedDoc?.name,
			),
		),
	);
	const open = useStore((state) => state.stateDockOpen);
	const setOpen = useStore((state) => state.setStateDockOpen);
	if (focusedDoc?.dataModel !== "state" && !template) return null;
	const label = template
		? t("structured_template_schema_open")
		: t("state_open_data");
	return (
		<button
			type="button"
			data-state-dock-trigger
			aria-label={label}
			title={label}
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
		<SegmentedControl
			label={t("state_render_mode")}
			value={mode}
			onChange={(nextMode) => setMode(focusedDoc.name, nextMode)}
			options={[
				{
					value: "live",
					label: t("state_live_mode"),
					icon: <Eye size={14} />,
				},
				{
					value: "design",
					label: t("state_design_mode"),
					icon: <Code2 size={14} />,
				},
			]}
		/>
	);
}
