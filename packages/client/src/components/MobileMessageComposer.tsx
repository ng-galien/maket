import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import { useModalFocusTrap } from "./shared/useModalFocusTrap";

interface Props {
	documentName: string;
	context?: string;
	value: string;
	onChange: (value: string) => void;
	onCancel: () => void;
	onSubmit: () => void;
	saving: boolean;
	disabled?: boolean;
	sent?: boolean;
	error?: string | null;
	submitLabel?: string;
	children?: ReactNode;
}

/** Mobile presentation only: the caller owns the message, its scope and persistence. */
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
export function MobileMessageComposer(props: Props) {
	const {
		documentName,
		context,
		value,
		onChange,
		onCancel,
		onSubmit,
		saving,
		disabled,
		sent,
		error,
		submitLabel,
		children,
	} = props;
	const t = useT();
	const panel = useRef<HTMLDivElement>(null);
	const field = useRef<HTMLTextAreaElement>(null);
	const [frame, setFrame] = useState({
		top: 0,
		left: 0,
		width: window.innerWidth,
		height: window.innerHeight,
	});
	useLayoutEffect(() => {
		const viewport = window.visualViewport;
		const place = () =>
			setFrame({
				top: viewport?.offsetTop ?? 0,
				left: viewport?.offsetLeft ?? 0,
				width: viewport?.width ?? window.innerWidth,
				height: viewport?.height ?? window.innerHeight,
			});
		place();
		window.addEventListener("resize", place);
		viewport?.addEventListener("resize", place);
		viewport?.addEventListener("scroll", place);
		return () => {
			window.removeEventListener("resize", place);
			viewport?.removeEventListener("resize", place);
			viewport?.removeEventListener("scroll", place);
		};
	}, []);
	useModalFocusTrap({
		open: true,
		containerRef: panel,
		initialFocusRef: field,
		onEscape: () => {
			if (!saving) onCancel();
		},
	});
	return createPortal(
		<div
			ref={panel}
			data-mobile-message-composer
			data-mobile-ui
			role="dialog"
			aria-modal="true"
			aria-label={t("mobile_document_note")}
			className="fixed z-[2100] flex flex-col overflow-hidden bg-panel text-text-1"
			style={frame}
		>
			<header className="shrink-0 border-b border-border pt-[env(safe-area-inset-top)]">
				<div className="flex min-h-16 items-center justify-between gap-4 px-3">
					<button
						type="button"
						onClick={onCancel}
						disabled={saving}
						className="min-h-12 rounded-xl px-3 text-base text-text-2 disabled:opacity-40"
					>
						{t("cancel")}
					</button>
					<button
						type="button"
						onClick={onSubmit}
						disabled={disabled || saving || sent || !value.trim()}
						aria-busy={saving}
						className="min-h-12 rounded-xl bg-accent px-5 text-base font-semibold text-accent-contrast disabled:opacity-40"
					>
						{saving ? t("pending_sending") : (submitLabel ?? t("message_send"))}
					</button>
				</div>
				<div className="px-6 pb-4">
					<h1 className="line-clamp-2 break-words text-lg font-semibold leading-6">
						{documentName}
					</h1>
					{context && (
						<p className="mt-1 line-clamp-2 break-words text-sm leading-5 text-text-2">
							{context}
						</p>
					)}
				</div>
			</header>
			<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
				<textarea
					ref={field}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					aria-label={t("mobile_document_note")}
					aria-invalid={error ? true : undefined}
					placeholder={t("mobile_message_placeholder")}
					readOnly={saving || sent}
					className="min-h-24 w-full flex-1 resize-none bg-transparent text-base leading-7 outline-none placeholder:text-text-3"
				/>
				{children}
				{sent && (
					<p role="status" className="text-base text-accent">
						{t("message_sent")}
					</p>
				)}
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
