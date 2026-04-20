import { Pin, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";

function highlightElement(id: string | undefined, on: boolean) {
	if (!id) return;
	const el = document.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
	if (!el) return;
	if (on) {
		el.style.outline = `3px solid var(--color-warning, #F59E0B)`;
		el.style.outlineOffset = "3px";
		el.style.transition = "outline 150ms ease";
	} else {
		el.style.outline = "";
		el.style.outlineOffset = "";
	}
}

function scrollToElement(id: string | undefined) {
	if (!id) return;
	const el = document.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
	if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function formatTime(ts: number): string {
	const d = new Date(ts);
	return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function MessagesPanel() {
	const t = useT();
	const open = useStore((s) => s.activePanel === "exchange");
	const barPosition = useStore((s) => s.barPosition);
	const [globalNote, setGlobalNote] = useState("");
	const hasDoc = useStore((s) => s.focusedDocName !== null);
	const pending = useStore((s) => s.pending);
	const addPending = useStore((s) => s.addPending);
	const removePending = useStore((s) => s.removePending);

	const barSide = 68;
	const freeSide = 8;
	const isTop = barPosition === "top";

	const panelStyle = isTop
		? { top: barSide, maxHeight: `calc(100vh - ${barSide + freeSide}px)` }
		: { bottom: barSide, maxHeight: `calc(100vh - ${barSide + freeSide}px)` };

	return (
		<div
			style={panelStyle}
			className={`fixed right-4 w-[280px] max-sm:w-[calc(100vw-2rem)] bg-panel border border-border rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.15)] z-[var(--z-panel)] flex flex-col overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
				open
					? "opacity-100 translate-x-0"
					: "opacity-0 translate-x-8 pointer-events-none"
			}`}
		>
			{/* Messages list */}
			<div
				className={`flex-1 overflow-y-auto px-3 py-2 flex gap-2 scrollbar-thin ${isTop ? "flex-col-reverse" : "flex-col"}`}
			>
				{pending.length === 0 ? (
					<div className="flex-1 flex items-center justify-center text-text-3 text-sm text-center px-4 whitespace-pre-line">
						{t("pending_empty")}
					</div>
				) : (
					pending.map((msg) => (
						<div
							role="button"
							tabIndex={0}
							onKeyDown={(e) => {
								if (e.key === "Enter") scrollToElement(msg.elementId);
							}}
							key={msg.id}
							className={`rounded-lg p-3 text-sm cursor-pointer transition-all ${
								msg.type === "delete"
									? "bg-danger-soft border border-danger-border"
									: "bg-input hover:bg-border/50"
							}`}
							onMouseEnter={() => highlightElement(msg.elementId, true)}
							onMouseLeave={() => highlightElement(msg.elementId, false)}
							onClick={() => scrollToElement(msg.elementId)}
						>
							<div className="flex items-start gap-2">
								<span className="flex-shrink-0 mt-0.5">
									{msg.type === "note" && (
										<Pin size={12} className="text-amber-500" />
									)}
									{msg.type === "delete" && (
										<Trash2 size={12} className="text-danger" />
									)}
								</span>
								<div className="flex-1 min-w-0">
									{msg.elementId && (
										<span className="text-2xs font-bold text-text-3 uppercase">
											{document
												.querySelector(`[data-id="${msg.elementId}"]`)
												?.getAttribute("data-name") || msg.elementId}
										</span>
									)}
									{msg.type === "note" && (
										<p className="text-text-1 mt-0.5">{msg.text}</p>
									)}
									{msg.type === "delete" && (
										<p className="text-danger mt-0.5">{t("pending_delete")}</p>
									)}
									{msg.type === "drop-image" && (
										<p className="text-text-1 mt-0.5">
											📷 {t("pending_insert_image", { file: msg.file ?? "" })}
										</p>
									)}
									{msg.type === "drop-text" && (
										<p className="text-text-1 mt-0.5">
											📝 {t("pending_insert_text")}
										</p>
									)}
									<span className="text-2xs text-text-3">
										{formatTime(msg.ts)}
									</span>
								</div>
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										removePending(msg.id);
									}}
									className="flex-shrink-0 p-1 rounded text-text-3 hover:text-danger transition-colors"
								>
									<X size={12} />
								</button>
							</div>
						</div>
					))
				)}
			</div>

			{/* Input — closest to bar */}
			<div
				className={`px-3 py-3 flex gap-1.5 ${isTop ? "border-b order-first" : "border-t order-last"} border-input/80 ${hasDoc ? "" : "opacity-30 pointer-events-none"}`}
			>
				<textarea
					value={globalNote}
					onChange={(e) => setGlobalNote(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey && globalNote.trim()) {
							e.preventDefault();
							addPending({
								id: crypto.randomUUID(),
								type: "note",
								text: globalNote.trim(),
								ts: Date.now(),
							});
							setGlobalNote("");
						}
					}}
					rows={3}
					placeholder={t("note_global_placeholder")}
					className="flex-1 px-2.5 py-2 bg-input rounded-lg text-sm outline-none placeholder:text-text-3 focus:ring-2 focus:ring-accent/20 resize-none"
				/>
				{globalNote && (
					<button
						type="button"
						onClick={() => {
							addPending({
								id: crypto.randomUUID(),
								type: "note",
								text: globalNote.trim(),
								ts: Date.now(),
							});
							setGlobalNote("");
						}}
						className="px-3 py-2 bg-accent text-white text-xs font-semibold rounded-lg hover:brightness-110 transition"
					>
						📌
					</button>
				)}
			</div>
		</div>
	);
}
