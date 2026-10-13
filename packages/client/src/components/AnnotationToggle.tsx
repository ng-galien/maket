import { MessageCircle } from "lucide-react";
import { useT } from "../i18n/useT";
import { pendingMessageCount } from "../lib/annotationMarkers";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";

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
					selectedIds: [],
					messageAnchor: null,
				});
			}}
			className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 ${active ? "bg-accent-soft text-accent" : "text-text-2 hover:bg-input hover:text-text-1"}`}
		>
			<MessageCircle size={18} strokeWidth={1.65} />
			{pendingCount > 0 && (
				<span
					data-annotation-pending-count={pendingCount}
					className="pointer-events-none absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none tabular-nums text-accent-contrast"
				>
					{pendingCount}
				</span>
			)}
		</button>
	);
}
