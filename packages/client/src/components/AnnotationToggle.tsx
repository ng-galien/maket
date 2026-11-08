import { Pencil } from "lucide-react";
import { useT } from "../i18n/useT";
import { pendingMessageCount } from "../lib/annotationMarkers";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { Tooltip } from "./shared/Tooltip";
import { WORKSPACE_TOGGLE_BUTTON_CLASS } from "./shared/toolbarButtonStyles";

/** One annotation tool shared by the canvas and connected Reader toolbars. */
export function AnnotationToggle({ doc }: { doc: Document }) {
	const t = useT();
	const readOnly = useStore((state) => state.readOnly);
	const active = useStore((state) => state.annotationDocName === doc.name);
	const editing = useStore((state) => state.editingElementId !== null);
	const pendingCount = useStore((state) =>
		pendingMessageCount(state.pending, doc.name),
	);
	if (readOnly || doc.meta?.locked) return null;
	return (
		<Tooltip>
			<button
				type="button"
				aria-label={t("annotate_document")}
				aria-pressed={active}
				disabled={editing}
				title={
					pendingCount > 0
						? `${t(active ? "annotation_mode_stop" : "annotation_mode_start")} — ${t("pending_count", { count: pendingCount })}`
						: t(active ? "annotation_mode_stop" : "annotation_mode_start")
				}
				onClick={() => {
					useStore.getState().setFocusedDoc(doc.name);
					useStore.setState({
						annotationDocName: active ? null : doc.name,
						...(!active ? { composerDocName: null } : {}),
						selectedIds: [],
						messageAnchor: null,
					});
				}}
				className={`${WORKSPACE_TOGGLE_BUTTON_CLASS} ${active ? "bg-accent-soft text-accent" : "text-text-2 hover:bg-input hover:text-text-1"}`}
			>
				<Pencil size={18} strokeWidth={1.65} />
				{pendingCount > 0 && (
					<span
						data-annotation-pending-count={pendingCount}
						className="pointer-events-none absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none tabular-nums text-accent-contrast"
					>
						{pendingCount}
					</span>
				)}
			</button>
		</Tooltip>
	);
}
