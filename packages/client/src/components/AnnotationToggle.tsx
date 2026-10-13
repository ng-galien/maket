import { MessageCircle } from "lucide-react";
import { useT } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";

/** One annotation tool shared by the canvas and connected Reader toolbars. */
export function AnnotationToggle({ doc }: { doc: Document }) {
	const t = useT();
	const readOnly = useStore((state) => state.readOnly);
	const active = useStore((state) => state.annotationDocName === doc.name);
	const editing = useStore((state) => state.editingElementId !== null);
	if (readOnly || doc.meta?.locked) return null;
	return (
		<button
			type="button"
			aria-label={t("annotate_document")}
			aria-pressed={active}
			disabled={editing}
			title={t(active ? "annotation_mode_stop" : "annotation_mode_start")}
			onClick={() => {
				useStore.getState().setFocusedDoc(doc.name);
				useStore.setState({
					annotationDocName: active ? null : doc.name,
					selectedIds: [],
					showPopover: false,
				});
			}}
			className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 ${active ? "bg-accent-soft text-accent" : "text-text-2 hover:bg-input hover:text-text-1"}`}
		>
			<MessageCircle size={18} strokeWidth={1.65} />
		</button>
	);
}
