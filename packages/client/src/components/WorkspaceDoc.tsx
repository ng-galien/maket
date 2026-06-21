import { X } from "lucide-react";
import { memo } from "react";
import { useDocByName, useStore } from "../store/useStore";
import { PageCanvas } from "./PageCanvas";
import { DraftPill } from "./shared/DraftPill";

const PAGE_GAP = 12;

interface Props {
	docName: string;
	zoomK: number;
}

export const WorkspaceDoc = memo(function WorkspaceDoc({
	docName,
	zoomK,
}: Props) {
	const doc = useDocByName(docName);
	const charteCss = useStore((s) => s.chartesCss.get(docName) ?? "");
	const isFocused = useStore((s) => s.focusedDocName === docName);
	const pendingCount = useStore(
		(s) => s.pending.filter((m) => m.docName === docName).length,
	);
	const removeDoc = useStore((s) => s.removeDocFromWorkspace);
	const setFocused = useStore((s) => s.setFocusedDoc);

	if (!doc) return null;

	const docWidthPx = doc.canvas.w * 3.78;
	const labelScale = 1 / Math.max(zoomK, 0.1);
	const labelMaxWidth = docWidthPx / labelScale;
	const pageKey = (page: (typeof doc.pages)[number]) =>
		`${docName}:${page.name ?? ""}:${page.html ?? ""}`;

	return (
		<div
			data-doc={docName}
			onClick={() => setFocused(docName)}
			className="flex flex-col items-center shrink-0 select-none"
			style={{ gap: PAGE_GAP }}
		>
			{doc.pages.map((_page, i) => (
				<div key={pageKey(_page)} className="flex flex-col items-center">
					<PageCanvas
						doc={doc}
						pageIndex={i}
						charteCss={charteCss}
						focused={isFocused}
					/>
					{doc.pages.length > 1 && (
						<span
							className="text-text-3 mt-1"
							style={{
								fontSize: `${11 / Math.max(zoomK, 0.1)}px`,
								transformOrigin: "top center",
							}}
						>
							{_page.name || `${i + 1} / ${doc.pages.length}`}
						</span>
					)}
				</div>
			))}

			{/* Doc label — counter-scaled */}
			<div
				className="doc-label relative"
				style={{
					transform: `scale(${labelScale})`,
					transformOrigin: "top center",
				}}
			>
				<div
					className={`flex items-center gap-1.5 px-3 py-1 rounded-xl whitespace-nowrap overflow-hidden transition-colors ${
						isFocused ? "bg-accent-soft" : "bg-black/[0.03]"
					}`}
					style={{ maxWidth: labelMaxWidth }}
				>
					{isFocused && (
						<div className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
					)}
					<span
						className={`doc-label-name text-base overflow-hidden ${isFocused ? "font-bold text-accent" : "font-medium text-text-2"}`}
					>
						{doc.name}
					</span>
					<span className="text-2xs text-text-3 shrink-0">
						{doc.canvas.format} · {doc.pages.length}p
					</span>
					{doc.meta?.emailDraftUrl && (
						<DraftPill
							kind={
								doc.meta?.emailDraftRole === "attachment"
									? "attachment"
									: "body"
							}
							url={doc.meta.emailDraftUrl}
						/>
					)}
					{pendingCount > 0 && (
						<span className="text-2xs font-bold text-white bg-accent rounded-full px-1.5 py-px min-w-[18px] text-center shrink-0">
							{pendingCount}
						</span>
					)}
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							removeDoc(docName);
						}}
						className="doc-close-btn w-5 h-5 rounded-md flex items-center justify-center text-text-3 p-0 border-none bg-transparent cursor-pointer shrink-0"
					>
						<X size={12} />
					</button>
				</div>
				<div className="doc-tooltip">
					<div className="font-semibold text-sm">{doc.name}</div>
					<div className="text-2xs text-text-3 mt-0.5">
						{doc.canvas.format} {doc.canvas.orientation} · {doc.canvas.w}×
						{doc.canvas.h}mm · {doc.pages.length} page
						{doc.pages.length > 1 ? "s" : ""}
					</div>
				</div>
			</div>
		</div>
	);
});
