import type { ChartesListItem } from "@maket/shared";
import { ArrowLeft, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { wsSend } from "../store/ws";

/** Shared envelope (`{ name }`) plus the fields this panel actually renders. */
interface Charte extends ChartesListItem {
	description?: string;
	tokens?: Record<string, Record<string, string>>;
	voice?: {
		personality?: string[];
		formality?: string;
		do?: string[];
		dont?: string[];
	};
	rules?: Record<string, string> | string;
}

function parseRules(rules: any): Record<string, string> {
	if (!rules) return {};
	if (typeof rules === "string") {
		try {
			return JSON.parse(rules);
		} catch {
			return {};
		}
	}
	return rules;
}

function parseVoice(voice: any): any {
	if (!voice) return null;
	if (typeof voice === "string") {
		try {
			return JSON.parse(voice);
		} catch {
			return null;
		}
	}
	return voice;
}

export function ChartesTab() {
	const t = useT();
	const [chartes, setChartes] = useState<Charte[]>([]);
	const [preview, setPreview] = useState<Charte | null>(null);
	const [loading, setLoading] = useState(true);
	const hasDoc = useStore((s) => s.focusedDocName !== null);
	const currentCharte = useStore((s) => {
		const doc = s.focusedDocName ? s.docs.get(s.focusedDocName) : null;
		return doc?.meta?.charte as string | undefined;
	});
	const barPosition = useStore((s) => s.barPosition);
	const chartesVersion = useStore((s) => s.chartesVersion);

	useEffect(() => {
		fetch("/api/chartes")
			.then((r) => r.json())
			.then((data) => {
				setChartes(data);
				setLoading(false);
			})
			.catch(() => setLoading(false));
	}, [chartesVersion]);

	const applyCharte = (name: string) => {
		const docName = useStore.getState().focusedDocName;
		if (!docName) return;
		wsSend({ type: "update_meta", docName, charte: name });
	};

	if (loading)
		return (
			<div className="text-center text-text-3 text-xs py-6">{t("loading")}</div>
		);
	if (chartes.length === 0)
		return (
			<div className="text-center text-text-3 text-xs py-6">
				{t("no_charte")}
			</div>
		);

	// Preview mode — inline, replaces the list
	if (preview) {
		return (
			<ChartePreviewInline
				charte={preview}
				onBack={() => setPreview(null)}
				barPosition={barPosition}
			/>
		);
	}

	return (
		<div
			className={`flex ${barPosition === "bottom" ? "flex-col-reverse" : "flex-col"} gap-2 px-3 py-2`}
		>
			{chartes.map((c) => {
				const isActive = currentCharte === c.name;
				const colors = c.tokens?.color ? Object.entries(c.tokens.color) : [];

				return (
					<div
						key={c.name}
						className={`rounded-xl border transition-all overflow-hidden ${
							isActive
								? "border-accent bg-accent-soft"
								: "border-border bg-panel hover:border-border-hover"
						}`}
					>
						<button
							type="button"
							onClick={() => setPreview(c)}
							className="w-full flex items-center gap-2 p-3 text-left"
						>
							{isActive && (
								<Check size={14} className="text-accent flex-shrink-0" />
							)}
							<div className="flex-1 min-w-0">
								<div className="text-base font-semibold truncate">{c.name}</div>
								{c.description && (
									<div className="text-xs text-text-3 truncate">
										{c.description}
									</div>
								)}
							</div>
						</button>

						{colors.length > 0 && (
							<div className="flex gap-1 px-3 pb-2">
								{colors.slice(0, 8).map(([name, value]) => (
									<div
										key={name}
										title={`${name}: ${value}`}
										className="w-5 h-5 rounded-full border border-border/50"
										style={{ background: value }}
									/>
								))}
							</div>
						)}

						{!isActive && hasDoc && (
							<div className="px-3 pb-3">
								<button
									type="button"
									onClick={() => applyCharte(c.name)}
									className="w-full py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:brightness-110 transition"
								>
									{t("apply")}
								</button>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

function ChartePreviewInline({
	charte,
	onBack,
	barPosition,
}: {
	charte: Charte;
	onBack: () => void;
	barPosition: "top" | "bottom";
}) {
	const t = useT();
	const colors = charte.tokens?.color
		? Object.entries(charte.tokens.color)
		: [];
	const fonts = charte.tokens?.font ? Object.entries(charte.tokens.font) : [];
	const spacing = charte.tokens?.spacing
		? Object.entries(charte.tokens.spacing)
		: [];
	const voice = parseVoice(charte.voice);
	const rules = parseRules(charte.rules);

	return (
		<div
			className={`flex ${barPosition === "bottom" ? "flex-col-reverse" : "flex-col"} p-3 gap-4`}
		>
			{/* Back button + title */}
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onBack}
					className="p-1.5 rounded-lg text-text-3 hover:text-text-1 hover:bg-input transition"
				>
					<ArrowLeft size={16} />
				</button>
				<div className="flex-1 min-w-0">
					<div className="text-md font-bold truncate">{charte.name}</div>
					{charte.description && (
						<div className="text-xs text-text-3 truncate">
							{charte.description}
						</div>
					)}
				</div>
			</div>

			{/* Colors */}
			{colors.length > 0 && (
				<section>
					<h3 className="text-xs font-bold text-text-3 uppercase tracking-wider mb-2">
						Couleurs
					</h3>
					<div className="flex flex-wrap gap-2">
						{colors.map(([name, value]) => (
							<div
								key={name}
								className="flex items-center gap-2 bg-input rounded-lg px-2.5 py-1.5"
							>
								<div
									className="w-5 h-5 rounded-full border border-border/50"
									style={{ background: value }}
								/>
								<div>
									<div className="text-xs font-semibold">{name}</div>
									<div className="text-2xs text-text-3 font-mono">{value}</div>
								</div>
							</div>
						))}
					</div>
				</section>
			)}

			{/* Fonts */}
			{fonts.length > 0 && (
				<section>
					<h3 className="text-xs font-bold text-text-3 uppercase tracking-wider mb-2">
						{t("fonts")}
					</h3>
					<div className="flex flex-col gap-1">
						{fonts.map(([role, family]) => (
							<div key={role} className="flex items-baseline gap-2">
								<span className="text-xs text-text-3 min-w-[60px]">{role}</span>
								<span
									className="text-base font-medium"
									style={{ fontFamily: family }}
								>
									{family.split(",")[0].replace(/'/g, "")}
								</span>
							</div>
						))}
					</div>
				</section>
			)}

			{/* Spacing */}
			{spacing.length > 0 && (
				<section>
					<h3 className="text-xs font-bold text-text-3 uppercase tracking-wider mb-2">
						Espacements
					</h3>
					<div className="flex flex-wrap gap-2">
						{spacing.map(([name, value]) => (
							<span
								key={name}
								className="text-xs font-medium px-2.5 py-1 rounded-full bg-input text-text-2"
							>
								{name}: {value}
							</span>
						))}
					</div>
				</section>
			)}

			{/* Voice */}
			{voice && (
				<section>
					<h3 className="text-xs font-bold text-text-3 uppercase tracking-wider mb-2">
						{t("voice_tone")}
					</h3>
					{voice.personality && (
						<div className="flex flex-wrap gap-1.5 mb-2">
							{voice.personality.map((p: string) => (
								<span
									key={p}
									className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent-soft text-accent"
								>
									{p}
								</span>
							))}
						</div>
					)}
					{voice.formality && (
						<div className="text-sm text-text-2 mb-2">
							{t("voice_formality")} : {voice.formality}
						</div>
					)}
					{voice.do && (
						<div className="mb-2">
							<div className="text-2xs font-bold text-green-600 mb-1">
								{t("voice_do")}
							</div>
							{voice.do.map((d: string) => (
								<div key={d} className="text-xs text-text-2 pl-3">
									• {d}
								</div>
							))}
						</div>
					)}
					{voice.dont && (
						<div className="mb-2">
							<div className="text-2xs font-bold text-danger mb-1">
								{t("voice_dont")}
							</div>
							{voice.dont.map((d: string) => (
								<div key={d} className="text-xs text-text-2 pl-3">
									• {d}
								</div>
							))}
						</div>
					)}
				</section>
			)}

			{/* Rules */}
			{Object.keys(rules).length > 0 && (
				<section>
					<h3 className="text-xs font-bold text-text-3 uppercase tracking-wider mb-2">
						{t("rules")}
					</h3>
					{Object.entries(rules).map(([key, val]) => (
						<div key={key} className="mb-2">
							<div className="text-xs font-bold text-text-2 capitalize">
								{key}
							</div>
							<div className="text-xs text-text-3">{val}</div>
						</div>
					))}
				</section>
			)}
		</div>
	);
}
