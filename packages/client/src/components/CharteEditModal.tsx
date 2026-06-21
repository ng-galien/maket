import type { ChartesListItem } from "@maket/shared";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import { wsSend } from "../store/ws";

/** Same loose envelope the `ChartesTab` builds from `/api/chartes`. */
interface CharteInput extends ChartesListItem {
	description?: string;
	tokens?: Record<string, Record<string, string>>;
	voice?: {
		personality?: string[];
		formality?: string;
		do?: string[];
		dont?: string[];
		vocabulary?: string[];
	};
	rules?: Record<string, string> | string;
}

type TokenRow = [string, string];
type TokenGroupKey = "color" | "font" | "spacing" | "radius";
type TokenState = Record<TokenGroupKey, TokenRow[]>;

const TOKEN_GROUPS: TokenGroupKey[] = ["color", "font", "spacing", "radius"];

function parseRules(rules: CharteInput["rules"]): Record<string, string> {
	if (!rules) return {};
	if (typeof rules === "string") {
		try {
			return JSON.parse(rules) as Record<string, string>;
		} catch {
			return {};
		}
	}
	return rules;
}

function toTokenState(tokens: CharteInput["tokens"]): TokenState {
	const state = {} as TokenState;
	for (const group of TOKEN_GROUPS) {
		const bucket = tokens?.[group];
		state[group] = bucket ? Object.entries(bucket) : [];
	}
	return state;
}

function serializeTokens(
	state: TokenState,
): Record<string, Record<string, string>> {
	const out: Record<string, Record<string, string>> = {};
	for (const group of TOKEN_GROUPS) {
		const rows = state[group].filter(([k]) => k.trim() !== "");
		if (rows.length === 0) continue;
		out[group] = Object.fromEntries(rows.map(([k, v]) => [k.trim(), v]));
	}
	return out;
}

function splitLines(s: string): string[] {
	return s
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
}

function splitCsv(s: string): string[] {
	return s
		.split(",")
		.map((l) => l.trim())
		.filter(Boolean);
}

interface Props {
	charte: CharteInput;
	onClose: () => void;
}

export function CharteEditModal({ charte, onClose }: Props) {
	const t = useT();
	const [description, setDescription] = useState(charte.description ?? "");
	const [tokens, setTokens] = useState<TokenState>(() =>
		toTokenState(charte.tokens),
	);
	const [personality, setPersonality] = useState(
		(charte.voice?.personality ?? []).join(", "),
	);
	const [formality, setFormality] = useState(charte.voice?.formality ?? "");
	const [voiceDo, setVoiceDo] = useState((charte.voice?.do ?? []).join("\n"));
	const [voiceDont, setVoiceDont] = useState(
		(charte.voice?.dont ?? []).join("\n"),
	);
	const initialRules = useMemo(() => parseRules(charte.rules), [charte.rules]);
	const [rTitles, setRTitles] = useState(initialRules.titles ?? "");
	const [rPhotos, setRPhotos] = useState(initialRules.photos ?? "");
	const [rLayout, setRLayout] = useState(initialRules.layout ?? "");

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	const updateRow = (
		group: TokenGroupKey,
		idx: number,
		field: 0 | 1,
		value: string,
	) => {
		setTokens((prev) => {
			const next = { ...prev, [group]: [...prev[group]] };
			const row = [...next[group][idx]] as TokenRow;
			row[field] = value;
			next[group][idx] = row;
			return next;
		});
	};

	const addRow = (group: TokenGroupKey) => {
		setTokens((prev) => ({ ...prev, [group]: [...prev[group], ["", ""]] }));
	};

	const removeRow = (group: TokenGroupKey, idx: number) => {
		setTokens((prev) => ({
			...prev,
			[group]: prev[group].filter((_, i) => i !== idx),
		}));
	};

	const save = () => {
		const personalityList = splitCsv(personality);
		const doList = splitLines(voiceDo);
		const dontList = splitLines(voiceDont);

		const modeledTokens = serializeTokens(tokens);
		const mergedTokens: Record<string, Record<string, string>> = {
			...(charte.tokens ?? {}),
		};
		for (const group of TOKEN_GROUPS) {
			if (modeledTokens[group]) mergedTokens[group] = modeledTokens[group];
			else delete mergedTokens[group];
		}

		const originalVoice = charte.voice ?? {};
		const mergedVoice: NonNullable<CharteInput["voice"]> = { ...originalVoice };
		mergedVoice.personality = personalityList.length
			? personalityList
			: undefined;
		mergedVoice.formality = formality.trim() || undefined;
		mergedVoice.do = doList.length ? doList : undefined;
		mergedVoice.dont = dontList.length ? dontList : undefined;
		for (const key of Object.keys(
			mergedVoice,
		) as (keyof typeof mergedVoice)[]) {
			if (mergedVoice[key] === undefined) delete mergedVoice[key];
		}

		const mergedRules: Record<string, string> = { ...initialRules };
		const setOrDelete = (key: string, value: string) => {
			const trimmed = value.trim();
			if (trimmed) mergedRules[key] = trimmed;
			else delete mergedRules[key];
		};
		setOrDelete("titles", rTitles);
		setOrDelete("photos", rPhotos);
		setOrDelete("layout", rLayout);

		wsSend({
			type: "charte_save",
			name: charte.name,
			description: description.trim() || undefined,
			tokens: mergedTokens,
			voice: Object.keys(mergedVoice).length ? mergedVoice : undefined,
			rules: Object.keys(mergedRules).length ? mergedRules : undefined,
		});
		onClose();
	};

	return createPortal(
		<div
			className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"
			role="dialog"
			aria-modal="true"
			aria-label={t("charte_edit_title")}
		>
			<button
				type="button"
				aria-label={t("cancel")}
				onClick={onClose}
				className="absolute inset-0 bg-black/30"
			/>
			<div className="relative bg-panel rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.22)] border border-black/5 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
				<header className="flex items-center gap-3 px-5 py-4 border-b border-black/5">
					<div className="flex-1 min-w-0">
						<div className="text-xs font-bold text-text-3 uppercase tracking-wider">
							{t("charte_edit_title")}
						</div>
						<div className="text-base font-bold truncate">{charte.name}</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label={t("cancel")}
						className="w-8 h-8 rounded-md flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-black/[0.06] transition"
					>
						<X size={16} />
					</button>
				</header>

				<div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
					<Field label={t("charte_edit_description")}>
						<input
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder={t("charte_edit_description_placeholder")}
							className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
						/>
					</Field>

					<section className="flex flex-col gap-3">
						<SectionTitle>{t("charte_edit_tokens")}</SectionTitle>
						{TOKEN_GROUPS.map((group) => (
							<TokenGroup
								key={group}
								group={group}
								label={t(`charte_edit_token_group_${group}`)}
								rows={tokens[group]}
								onChange={(idx, field, value) =>
									updateRow(group, idx, field, value)
								}
								onAdd={() => addRow(group)}
								onRemove={(idx) => removeRow(group, idx)}
								addLabel={t("charte_edit_token_add")}
								keyLabel={t("charte_edit_token_key")}
								valueLabel={t("charte_edit_token_value")}
								removeLabel={t("charte_edit_token_remove")}
							/>
						))}
					</section>

					<section className="flex flex-col gap-3">
						<SectionTitle>{t("charte_edit_voice")}</SectionTitle>
						<Field label={t("charte_edit_voice_personality")}>
							<input
								value={personality}
								onChange={(e) => setPersonality(e.target.value)}
								className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
							/>
						</Field>
						<Field label={t("charte_edit_voice_formality")}>
							<input
								value={formality}
								onChange={(e) => setFormality(e.target.value)}
								className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
							/>
						</Field>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
							<Field label={t("charte_edit_voice_do")}>
								<textarea
									value={voiceDo}
									onChange={(e) => setVoiceDo(e.target.value)}
									rows={4}
									className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20 resize-y"
								/>
							</Field>
							<Field label={t("charte_edit_voice_dont")}>
								<textarea
									value={voiceDont}
									onChange={(e) => setVoiceDont(e.target.value)}
									rows={4}
									className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20 resize-y"
								/>
							</Field>
						</div>
					</section>

					<section className="flex flex-col gap-3">
						<SectionTitle>{t("charte_edit_rules")}</SectionTitle>
						<Field label={t("charte_edit_rules_titles")}>
							<textarea
								value={rTitles}
								onChange={(e) => setRTitles(e.target.value)}
								rows={2}
								className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20 resize-y"
							/>
						</Field>
						<Field label={t("charte_edit_rules_photos")}>
							<textarea
								value={rPhotos}
								onChange={(e) => setRPhotos(e.target.value)}
								rows={2}
								className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20 resize-y"
							/>
						</Field>
						<Field label={t("charte_edit_rules_layout")}>
							<textarea
								value={rLayout}
								onChange={(e) => setRLayout(e.target.value)}
								rows={2}
								className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20 resize-y"
							/>
						</Field>
					</section>
				</div>

				<footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-black/5">
					<button
						type="button"
						onClick={onClose}
						className="px-4 py-2 rounded-lg text-sm font-semibold text-text-2 hover:bg-black/[0.05] transition"
					>
						{t("cancel")}
					</button>
					<button
						type="button"
						onClick={save}
						className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:brightness-110 transition"
					>
						{t("save")}
					</button>
				</footer>
			</div>
		</div>,
		document.body,
	);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
	return (
		<h3 className="text-xs font-bold text-text-3 uppercase tracking-wider">
			{children}
		</h3>
	);
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-2xs font-semibold text-text-3 uppercase tracking-wider">
				{label}
			</span>
			{children}
		</div>
	);
}

interface TokenGroupProps {
	label: string;
	group: TokenGroupKey;
	rows: TokenRow[];
	onChange: (idx: number, field: 0 | 1, value: string) => void;
	onAdd: () => void;
	onRemove: (idx: number) => void;
	addLabel: string;
	keyLabel: string;
	valueLabel: string;
	removeLabel: string;
}

function TokenGroup({
	label,
	group,
	rows,
	onChange,
	onAdd,
	onRemove,
	addLabel,
	keyLabel,
	valueLabel,
	removeLabel,
}: TokenGroupProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between">
				<span className="text-2xs font-semibold text-text-3 uppercase tracking-wider">
					{label}
				</span>
				<button
					type="button"
					onClick={onAdd}
					className="flex items-center gap-1 text-xs font-semibold text-accent hover:brightness-110 transition"
				>
					<Plus size={12} />
					{addLabel}
				</button>
			</div>
			{rows.length === 0 ? (
				<div className="text-2xs text-text-3 italic px-1">—</div>
			) : (
				<div className="flex flex-col gap-1.5">
					{rows.map((row, idx) => (
						<div key={idx} className="flex items-center gap-1.5">
							<input
								value={row[0]}
								onChange={(e) => onChange(idx, 0, e.target.value)}
								placeholder={keyLabel}
								className="flex-1 px-2.5 py-1.5 bg-input rounded-md text-sm outline-none focus:ring-2 focus:ring-accent/20"
							/>
							<TokenValueInput
								group={group}
								value={row[1]}
								onChange={(v) => onChange(idx, 1, v)}
								placeholder={valueLabel}
							/>
							<button
								type="button"
								onClick={() => onRemove(idx)}
								aria-label={
									row[0].trim()
										? `${removeLabel} "${row[0].trim()}"`
										: removeLabel
								}
								className="w-7 h-7 rounded-md flex items-center justify-center text-text-3 hover:text-danger hover:bg-danger-soft transition"
							>
								<Trash2 size={13} />
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

interface TokenValueInputProps {
	group: TokenGroupKey;
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
}

function TokenValueInput({
	group,
	value,
	onChange,
	placeholder,
}: TokenValueInputProps) {
	if (group === "color") {
		return (
			<ColorValueInput
				value={value}
				onChange={onChange}
				placeholder={placeholder}
			/>
		);
	}
	if (group === "spacing" || group === "radius") {
		return (
			<LengthValueInput
				value={value}
				onChange={onChange}
				placeholder={placeholder}
			/>
		);
	}
	return (
		<input
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			className="flex-[2] px-2.5 py-1.5 bg-input rounded-md text-sm outline-none focus:ring-2 focus:ring-accent/20 font-mono"
		/>
	);
}

/** Native color input paired with a free-text field so `var(...)`, named
 * colors, and rgb()/hsl() values stay editable. Picker syncs whenever
 * `toHex6()` can normalise the text to `#rrggbb` — i.e. any 3/4/6/8-digit
 * hex (alpha from 4/8-digit forms is dropped, the native picker has no
 * alpha channel). */
function ColorValueInput({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
}) {
	const pickerValue = toHex6(value) ?? "#000000";
	const pickerDisabled = toHex6(value) === null;
	return (
		<div className="flex-[2] flex items-center gap-1.5">
			<input
				type="color"
				value={pickerValue}
				onChange={(e) => onChange(e.target.value)}
				aria-label={placeholder}
				disabled={pickerDisabled && value.trim() !== ""}
				className="w-8 h-8 rounded-md border border-black/10 bg-transparent cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 p-0 flex-shrink-0"
				style={{ padding: 0 }}
			/>
			<input
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className="flex-1 min-w-0 px-2.5 py-1.5 bg-input rounded-md text-sm outline-none focus:ring-2 focus:ring-accent/20 font-mono"
			/>
		</div>
	);
}

/** Return `#rrggbb` when the value is any hex shape `<input type="color">`
 * can render (3/4/6/8 digits), otherwise `null`. Alpha from 4/8-digit hex is
 * dropped — the native picker has no alpha channel, so it can't round-trip. */
function toHex6(raw: string): string | null {
	const v = raw.trim();
	const m = v.match(/^#([0-9a-f]{3,8})$/i);
	if (!m) return null;
	const hex = m[1];
	if (hex.length === 3)
		return `#${hex
			.split("")
			.map((c) => c + c)
			.join("")}`.toLowerCase();
	if (hex.length === 4)
		return `#${hex
			.slice(0, 3)
			.split("")
			.map((c) => c + c)
			.join("")}`.toLowerCase();
	if (hex.length === 6) return `#${hex}`.toLowerCase();
	if (hex.length === 8) return `#${hex.slice(0, 6)}`.toLowerCase();
	return null;
}

const LENGTH_UNITS = [
	"mm",
	"cm",
	"px",
	"rem",
	"em",
	"%",
	"vh",
	"vw",
	"pt",
	"in",
] as const;
type LengthUnit = (typeof LENGTH_UNITS)[number];

function parseLength(raw: string): { num: string; unit: LengthUnit } | null {
	const m = raw.trim().match(/^(-?\d*\.?\d*)(mm|cm|px|rem|em|%|vh|vw|pt|in)$/i);
	if (!m) return null;
	const unit = m[2].toLowerCase() as LengthUnit;
	return { num: m[1], unit };
}

/** Number + unit select. Falls back to plain text for values we can't parse
 * (calc(), clamp(), var(), bare integers without a unit, etc.). */
function LengthValueInput({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
}) {
	const parsed = parseLength(value);
	if (!parsed) {
		return (
			<input
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className="flex-[2] px-2.5 py-1.5 bg-input rounded-md text-sm outline-none focus:ring-2 focus:ring-accent/20 font-mono"
			/>
		);
	}
	return (
		<div className="flex-[2] flex items-center gap-1.5">
			<input
				type="text"
				inputMode="decimal"
				value={parsed.num}
				onChange={(e) => onChange(`${e.target.value}${parsed.unit}`)}
				placeholder={placeholder}
				className="flex-1 min-w-0 px-2.5 py-1.5 bg-input rounded-md text-sm outline-none focus:ring-2 focus:ring-accent/20 font-mono"
			/>
			<select
				value={parsed.unit}
				onChange={(e) => onChange(`${parsed.num}${e.target.value}`)}
				className="px-1.5 py-1.5 bg-input rounded-md text-sm outline-none focus:ring-2 focus:ring-accent/20 font-mono cursor-pointer"
			>
				{LENGTH_UNITS.map((u) => (
					<option key={u} value={u}>
						{u}
					</option>
				))}
			</select>
		</div>
	);
}
