import { useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import { useModalFocusTrap } from "./shared/useModalFocusTrap";

/** Name editing presentation; the caller owns validation and the rename command. */
export function MobileDocumentRename({
	name,
	value,
	onChange,
	onCancel,
	onSubmit,
	error,
	disabled,
}: {
	name: string;
	value: string;
	onChange: (value: string) => void;
	onCancel: () => void;
	onSubmit: () => void;
	error: string;
	disabled: boolean;
}) {
	const t = useT();
	const panel = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLInputElement>(null);
	useModalFocusTrap({
		open: true,
		containerRef: panel,
		initialFocusRef: input,
		onEscape: onCancel,
	});
	return createPortal(
		<div
			ref={panel}
			data-mobile-ui
			data-mobile-document-rename
			role="dialog"
			aria-modal="true"
			aria-label={t("doc_rename")}
			className="fixed inset-0 z-[2100] flex flex-col bg-panel text-text-1"
		>
			<header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-3 pt-[env(safe-area-inset-top)]">
				<button
					type="button"
					onClick={onCancel}
					className="min-h-12 rounded-xl px-3 text-base"
				>
					{t("cancel")}
				</button>
				<button
					type="button"
					onClick={onSubmit}
					disabled={disabled || !value.trim() || value.trim() === name}
					className="min-h-12 rounded-xl bg-accent px-5 text-base font-semibold text-accent-contrast disabled:opacity-40"
				>
					{t("save")}
				</button>
			</header>
			<div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-6">
				<h1 className="break-words text-lg font-semibold">{name}</h1>
				<label className="flex flex-col gap-2 text-base">
					{t("doc_rename_prompt")}
					<input
						ref={input}
						value={value}
						onChange={(event) => onChange(event.target.value)}
						onFocus={(event) => event.target.select()}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								onSubmit();
							}
						}}
						aria-invalid={error ? true : undefined}
						className="min-h-12 rounded-xl border border-border bg-input px-3 text-base outline-none focus:ring-2 focus:ring-accent"
					/>
				</label>
				{error && (
					<p role="alert" className="text-base text-danger">
						{error}
					</p>
				)}
			</div>
		</div>,
		document.body,
	);
}
