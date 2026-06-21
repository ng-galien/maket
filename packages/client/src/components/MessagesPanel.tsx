import {
	FileText,
	Images,
	Layers,
	MousePointerClick,
	Pin,
	Send,
	Trash2,
	Type,
	X,
} from "lucide-react";
import { useState } from "react";
import { useT } from "../i18n/useT";
import type { PendingMessage } from "../store/useStore";
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

function resolveElementLabel(elementId: string): string {
	const el = document.querySelector(
		`[data-id="${elementId}"]`,
	) as HTMLElement | null;
	return el?.getAttribute("data-name") || elementId;
}

function TypeBadge({ type }: { type: PendingMessage["type"] }) {
	const base =
		"flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center";
	switch (type) {
		case "note":
			return (
				<span className={`${base} bg-amber-100 text-amber-600`}>
					<Pin size={12} />
				</span>
			);
		case "delete":
			return (
				<span className={`${base} bg-danger-soft text-danger`}>
					<Trash2 size={12} />
				</span>
			);
		case "drop-image":
			return (
				<span className={`${base} bg-accent-soft text-accent`}>
					<Images size={12} />
				</span>
			);
		case "drop-text":
			return (
				<span className={`${base} bg-accent-soft text-accent`}>
					<Type size={12} />
				</span>
			);
		case "classify-images":
			return (
				<span className={`${base} bg-accent-soft text-accent`}>
					<Images size={12} />
				</span>
			);
		default:
			return <span className={`${base} bg-input text-text-3`} />;
	}
}

function ScopeChips({ msg }: { msg: PendingMessage }) {
	const t = useT();
	const hasDoc = Boolean(msg.docName);
	const hasPage = typeof msg.pageIndex === "number";
	const hasEl = Boolean(msg.elementId);
	const elLabel = msg.elementId ? resolveElementLabel(msg.elementId) : "";

	if (!hasDoc && !hasPage && !hasEl) {
		return (
			<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-input text-2xs font-semibold text-text-3 uppercase tracking-wider">
				<Layers size={10} />
				{t("scope_workspace")}
			</span>
		);
	}

	return (
		<div className="flex flex-wrap items-center gap-1 text-2xs font-semibold text-text-3">
			{hasDoc && (
				<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-input max-w-[140px]">
					<FileText size={10} className="flex-shrink-0" />
					<span className="truncate">{msg.docName}</span>
				</span>
			)}
			{hasPage && (
				<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-input tabular-nums">
					<Layers size={10} className="flex-shrink-0" />p
					{(msg.pageIndex ?? 0) + 1}
				</span>
			)}
			{hasEl && (
				<span
					className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-input max-w-[140px]"
					title={msg.elementId}
				>
					<MousePointerClick size={10} className="flex-shrink-0" />
					<span className="truncate">{elLabel}</span>
				</span>
			)}
		</div>
	);
}

function MessageBody({ msg }: { msg: PendingMessage }) {
	const t = useT();
	if (msg.type === "note")
		return (
			<p className="text-sm text-text-1 leading-snug whitespace-pre-wrap break-words">
				{msg.text}
			</p>
		);
	if (msg.type === "delete")
		return (
			<p className="text-sm font-semibold text-danger">{t("pending_delete")}</p>
		);
	if (msg.type === "drop-image")
		return (
			<p className="text-sm text-text-1 break-words">
				{t("pending_insert_image", { file: msg.file ?? "" })}
			</p>
		);
	if (msg.type === "drop-text")
		return <p className="text-sm text-text-1">{t("pending_insert_text")}</p>;
	if (msg.type === "classify-images")
		return (
			<p className="text-sm text-text-1 leading-snug break-words">{msg.text}</p>
		);
	return null;
}

export function MessagesPanel() {
	const t = useT();
	const open = useStore((s) => s.activePanel === "exchange");
	const barPosition = useStore((s) => s.barPosition);
	const [globalNote, setGlobalNote] = useState("");
	const focusedDocName = useStore((s) => s.focusedDocName);
	const hasDoc = focusedDocName !== null;
	const pending = useStore((s) => s.pending);
	const addPending = useStore((s) => s.addPending);
	const removePending = useStore((s) => s.removePending);

	const barSide = 68;
	const freeSide = 8;
	const isTop = barPosition === "top";

	const panelStyle = isTop
		? { top: barSide, maxHeight: `calc(100vh - ${barSide + freeSide}px)` }
		: { bottom: barSide, maxHeight: `calc(100vh - ${barSide + freeSide}px)` };

	const submitNote = () => {
		const text = globalNote.trim();
		if (!text) return;
		addPending({
			id: crypto.randomUUID(),
			type: "note",
			text,
			ts: Date.now(),
		});
		setGlobalNote("");
	};

	return (
		<div
			style={panelStyle}
			className={`fixed right-4 w-[320px] max-sm:w-[calc(100vw-2rem)] bg-panel border border-border rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.15)] z-[var(--z-panel)] flex flex-col overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
				open
					? "opacity-100 translate-x-0"
					: "opacity-0 translate-x-8 pointer-events-none"
			}`}
		>
			<div
				className={`flex-1 overflow-y-auto px-3 py-2 flex gap-2 scrollbar-thin ${isTop ? "flex-col-reverse" : "flex-col"}`}
			>
				{pending.length === 0 ? (
					<div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-3 text-sm text-center px-4">
						<span className="w-10 h-10 rounded-full bg-input flex items-center justify-center">
							<Pin size={16} />
						</span>
						<span className="whitespace-pre-line leading-relaxed">
							{t("pending_empty")}
						</span>
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
							className={`group rounded-lg p-2.5 text-sm cursor-pointer transition-all ring-1 ${
								msg.type === "delete"
									? "bg-danger-soft ring-danger-border"
									: "bg-input/60 ring-black/[0.04] hover:bg-input hover:ring-accent/30"
							}`}
							onMouseEnter={() => highlightElement(msg.elementId, true)}
							onMouseLeave={() => highlightElement(msg.elementId, false)}
							onClick={() => scrollToElement(msg.elementId)}
						>
							<div className="flex items-start gap-2">
								<TypeBadge type={msg.type} />
								<div className="flex-1 min-w-0 flex flex-col gap-1">
									<ScopeChips msg={msg} />
									<MessageBody msg={msg} />
									<span className="text-2xs text-text-3 tabular-nums">
										{formatTime(msg.ts)}
									</span>
								</div>
								<button
									type="button"
									aria-label={t("bulk_clear")}
									onClick={(e) => {
										e.stopPropagation();
										removePending(msg.id);
									}}
									className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-text-3 opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-danger-soft transition"
								>
									<X size={12} />
								</button>
							</div>
						</div>
					))
				)}
			</div>

			<div
				className={`px-3 py-3 flex flex-col gap-1.5 ${isTop ? "border-b order-first" : "border-t order-last"} border-border/60 ${hasDoc ? "" : "opacity-40 pointer-events-none"}`}
			>
				<div className="px-0.5 text-2xs font-semibold text-text-3 flex items-center gap-1 min-w-0">
					<FileText size={10} className="flex-shrink-0" />
					<span className="truncate">
						{focusedDocName ?? t("scope_workspace")}
					</span>
				</div>
				<div className="flex gap-1.5 items-end">
					<textarea
						value={globalNote}
						onChange={(e) => setGlobalNote(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								submitNote();
							}
						}}
						rows={3}
						placeholder={t("note_global_placeholder")}
						className="flex-1 min-w-0 px-2.5 py-2 bg-input rounded-lg text-sm outline-none placeholder:text-text-3 focus:ring-2 focus:ring-accent/20 resize-none"
					/>
					<button
						type="button"
						onClick={submitNote}
						disabled={!globalNote.trim()}
						aria-label={t("pending_send_note")}
						title={t("pending_send_note")}
						className={`w-9 h-9 rounded-lg flex items-center justify-center transition flex-shrink-0 ${
							globalNote.trim()
								? "bg-accent text-white hover:brightness-110"
								: "bg-input text-text-3 cursor-not-allowed"
						}`}
					>
						<Send size={14} />
					</button>
				</div>
			</div>
		</div>
	);
}
