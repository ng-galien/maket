import { Pencil } from "lucide-react";
import { useT } from "../i18n/useT";
import { InspectorSection } from "./shared/InspectorSection";
import { InspectorSelect } from "./shared/InspectorSelect";
import { INSPECTOR_ACTION_CLASS } from "./shared/toolbarButtonStyles";

/** The current object has one primary action; destructive and data actions stay secondary. */
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Presentation adapter: editing and document mutations stay in PageCanvas and the WS store.
export function ComposerSelection({
	selection,
	actions,
	placeholders,
}: {
	selection: { editable: boolean; editing: boolean };
	actions: {
		onStart: () => void;
		onFinish: () => void;
		onCancel: () => void;
		onPlaceholder: (value: string) => void;
	};
	placeholders: Array<{ label: string; value: string }>;
}) {
	const { editable, editing } = selection;
	const { onStart, onFinish, onCancel, onPlaceholder } = actions;
	const t = useT();
	return (
		<div className="space-y-3">
			{editing ? (
				<div className="space-y-3">
					<div className="flex gap-2">
						<button
							type="button"
							onPointerDown={(event) => event.preventDefault()}
							onClick={onFinish}
							className={`${INSPECTOR_ACTION_CLASS} bg-accent-soft !text-accent`}
						>
							{t("hand_finish_text")}
						</button>
						<button
							type="button"
							onPointerDown={(event) => event.preventDefault()}
							onClick={onCancel}
							className={INSPECTOR_ACTION_CLASS}
						>
							{t("cancel")}
						</button>
					</div>
				</div>
			) : editable ? (
				<button
					type="button"
					onClick={onStart}
					className={INSPECTOR_ACTION_CLASS}
				>
					<Pencil size={16} strokeWidth={1.65} aria-hidden="true" />
					{t("edit_text")}
				</button>
			) : null}

			{editable && placeholders.length > 0 && (
				<InspectorSection label={t("hand_dynamic_fields")}>
					<InspectorSelect
						label={t("collection_use_placeholder")}
						value=""
						onChange={onPlaceholder}
						options={[
							{ value: "", label: t("hand_choose_field"), disabled: true },
							...placeholders,
						]}
					/>
				</InspectorSection>
			)}
		</div>
	);
}
