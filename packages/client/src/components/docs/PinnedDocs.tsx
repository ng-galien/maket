import { Pin } from "lucide-react";
import { useId } from "react";
import { useT } from "../../i18n/useT";
import { DocCard, DocRow } from "./DocItem";
import type { PinnedDocsModel } from "./types";

/** First library group: pinned documents, most recently pinned first. */
export function PinnedDocs({ model }: { model: PinnedDocsModel }) {
	const t = useT();
	const headingId = useId();
	if (model.docs.length === 0) return null;
	return (
		<section
			data-pinned-documents
			aria-labelledby={headingId}
			className="mb-1.5 min-w-0 border-b border-border/70 pb-1.5"
		>
			<div className="flex min-h-8 items-center gap-1.5 px-2">
				<Pin
					size={13}
					className="shrink-0 fill-current text-accent"
					aria-hidden
				/>
				<h3
					id={headingId}
					className="min-w-0 truncate text-base font-semibold text-text-1"
				>
					{t("pinned_documents")}
				</h3>
				<span className="ml-1 inline-flex h-5 min-w-8 shrink-0 items-center justify-center rounded-md bg-input/70 px-1.5 text-xs font-semibold tabular-nums text-text-2 ring-1 ring-inset ring-border/70">
					{model.docs.length}
				</span>
			</div>
			<div
				className={
					model.view === "grid"
						? "grid grid-cols-2 gap-2 px-1.5 py-1"
						: "flex flex-col gap-px"
				}
			>
				{model.docs.map((doc) => {
					const itemProps = model.itemFor(doc);
					return model.view === "grid" ? (
						<DocCard key={doc.name} {...itemProps} />
					) : (
						<DocRow key={doc.name} {...itemProps} />
					);
				})}
			</div>
		</section>
	);
}
