import {
	type CharteRulesWire,
	type ChartesListItem,
	parseCharteRules,
} from "@maket/shared";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import { wsSend } from "../store/ws";
import { randomId } from "../utils";

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
	rules?: CharteRulesWire;
}

interface TokenRow {
	id: string;
	key: string;
	value: string;
}

type TokenGroupKey = "color" | "font" | "spacing" | "radius";
type TokenState = Record<TokenGroupKey, TokenRow[]>;

const TOKEN_GROUPS: TokenGroupKey[] = ["color", "font", "spacing", "radius"];

function createTokenRow(key: string, value: string): TokenRow {
	return { id: randomId(), key, value };
}

function toTokenState(tokens: CharteInput["tokens"]): TokenState {
	const state = {} as TokenState;
	for (const group of TOKEN_GROUPS) {
		const bucket = tokens?.[group];
		state[group] = bucket
			? Object.entries(bucket).map(([key, value]) => createTokenRow(key, value))
			: [];
	}
	return state;
}

function serializeTokens(
	state: TokenState,
): Record<string, Record<string, string>> {
	const out: Record<string, Record<string, string>> = {};
	for (const group of TOKEN_GROUPS) {
		const rows = state[group].filter((row) => row.key.trim() !== "");
		if (rows.length === 0) continue;
		out[group] = Object.fromEntries(
			rows.map((row) => [row.key.trim(), row.value]),
		);
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
	const model = useCharteEditForm(charte, onClose);
	return createPortal(<CharteEditDialog model={model} />, document.body);
}

interface CharteEditForm {
	name: string;
	description: string;
	setDescription: (value: string) => void;
	tokens: TokenState;
	tokenActions: TokenGroupActionsByGroup;
	voice: VoiceFields;
	rules: RuleFields;
	onClose: () => void;
	save: () => void;
}

interface VoiceFields {
	personality: string;
	setPersonality: (value: string) => void;
	formality: string;
	setFormality: (value: string) => void;
	doText: string;
	setDoText: (value: string) => void;
	dontText: string;
	setDontText: (value: string) => void;
}

interface RuleFields {
	titles: string;
	setTitles: (value: string) => void;
	photos: string;
	setPhotos: (value: string) => void;
	layout: string;
	setLayout: (value: string) => void;
}

interface TokenGroupActionsByGroup {
	change: (
		group: TokenGroupKey,
		idx: number,
		field: 0 | 1,
		value: string,
	) => void;
	add: (group: TokenGroupKey) => void;
	remove: (group: TokenGroupKey, idx: number) => void;
}

function useCharteEditForm(
	charte: CharteInput,
	onClose: () => void,
): CharteEditForm {
	const [description, setDescription] = useState(charte.description ?? "");
	const tokenFields = useTokenFields(charte.tokens);
	const voice = useVoiceFields(charte.voice);
	const initialRules = useMemo(
		() => parseCharteRules(charte.rules),
		[charte.rules],
	);
	const rules = useRuleFields(initialRules);

	useDismissOnEscape(onClose);

	const save = () => {
		wsSend(
			buildCharteSavePayload(charte, {
				description,
				tokens: tokenFields.tokens,
				voice,
				rules,
				initialRules,
			}),
		);
		onClose();
	};

	return {
		name: charte.name,
		description,
		setDescription,
		tokens: tokenFields.tokens,
		tokenActions: tokenFields.actions,
		voice,
		rules,
		onClose,
		save,
	};
}

function useDismissOnEscape(onClose: () => void) {
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);
}

function useTokenFields(tokens: CharteInput["tokens"]) {
	const [state, setState] = useState<TokenState>(() => toTokenState(tokens));

	const change = (
		group: TokenGroupKey,
		idx: number,
		field: 0 | 1,
		value: string,
	) => {
		setState((prev) => {
			const next = { ...prev, [group]: [...prev[group]] };
			const row = next[group][idx];
			if (!row) return prev;
			next[group][idx] =
				field === 0 ? { ...row, key: value } : { ...row, value };
			return next;
		});
	};

	const add = (group: TokenGroupKey) => {
		setState((prev) => ({
			...prev,
			[group]: [...prev[group], createTokenRow("", "")],
		}));
	};

	const remove = (group: TokenGroupKey, idx: number) => {
		setState((prev) => ({
			...prev,
			[group]: prev[group].filter((_, i) => i !== idx),
		}));
	};

	return { tokens: state, actions: { change, add, remove } };
}

function useVoiceFields(voice: CharteInput["voice"]): VoiceFields {
	const [personality, setPersonality] = useState(
		(voice?.personality ?? []).join(", "),
	);
	const [formality, setFormality] = useState(voice?.formality ?? "");
	const [doText, setDoText] = useState((voice?.do ?? []).join("\n"));
	const [dontText, setDontText] = useState((voice?.dont ?? []).join("\n"));
	return {
		personality,
		setPersonality,
		formality,
		setFormality,
		doText,
		setDoText,
		dontText,
		setDontText,
	};
}

function useRuleFields(initialRules: Record<string, string>): RuleFields {
	const [titles, setTitles] = useState(initialRules.titles ?? "");
	const [photos, setPhotos] = useState(initialRules.photos ?? "");
	const [layout, setLayout] = useState(initialRules.layout ?? "");
	return { titles, setTitles, photos, setPhotos, layout, setLayout };
}

interface CharteSaveFormState {
	description: string;
	tokens: TokenState;
	voice: VoiceFields;
	rules: RuleFields;
	initialRules: Record<string, string>;
}

function buildCharteSavePayload(
	charte: CharteInput,
	form: CharteSaveFormState,
) {
	const mergedVoice = mergeVoice(charte.voice, form.voice);
	const mergedRules = mergeRules(form.initialRules, form.rules);
	return {
		type: "charte_save" as const,
		name: charte.name,
		description: form.description.trim() || undefined,
		tokens: mergeTokens(charte.tokens, form.tokens),
		voice: Object.keys(mergedVoice).length ? mergedVoice : undefined,
		rules: Object.keys(mergedRules).length ? mergedRules : undefined,
	};
}

function mergeTokens(original: CharteInput["tokens"], state: TokenState) {
	const modeledTokens = serializeTokens(state);
	const mergedTokens: Record<string, Record<string, string>> = {
		...(original ?? {}),
	};
	for (const group of TOKEN_GROUPS) {
		if (modeledTokens[group]) mergedTokens[group] = modeledTokens[group];
		else delete mergedTokens[group];
	}
	return mergedTokens;
}

function mergeVoice(original: CharteInput["voice"], voice: VoiceFields) {
	const mergedVoice: NonNullable<CharteInput["voice"]> = {
		...(original ?? {}),
	};
	const personality = splitCsv(voice.personality);
	const doList = splitLines(voice.doText);
	const dontList = splitLines(voice.dontText);
	mergedVoice.personality = personality.length ? personality : undefined;
	mergedVoice.formality = voice.formality.trim() || undefined;
	mergedVoice.do = doList.length ? doList : undefined;
	mergedVoice.dont = dontList.length ? dontList : undefined;
	for (const key of Object.keys(mergedVoice) as (keyof typeof mergedVoice)[]) {
		if (mergedVoice[key] === undefined) delete mergedVoice[key];
	}
	return mergedVoice;
}

function mergeRules(initialRules: Record<string, string>, rules: RuleFields) {
	const mergedRules: Record<string, string> = { ...initialRules };
	mergeRuleField(mergedRules, "titles", rules.titles);
	mergeRuleField(mergedRules, "photos", rules.photos);
	mergeRuleField(mergedRules, "layout", rules.layout);
	return mergedRules;
}

function mergeRuleField(
	rules: Record<string, string>,
	key: string,
	value: string,
) {
	const trimmed = value.trim();
	if (trimmed) rules[key] = trimmed;
	else delete rules[key];
}

function CharteEditDialog({ model }: { model: CharteEditForm }) {
	const t = useT();

	return (
		<div
			className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"
			role="dialog"
			aria-modal="true"
			aria-label={t("charte_edit_title")}
		>
			<button
				type="button"
				aria-label={t("cancel")}
				onClick={model.onClose}
				className="absolute inset-0 bg-black/30"
			/>
			<div className="relative bg-panel rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.22)] border border-black/5 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
				<CharteEditHeader model={model} />

				<div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
					<DescriptionField model={model} />
					<TokenFields model={model} />
					<VoiceFieldsSection voice={model.voice} />
					<RulesFields rules={model.rules} />
				</div>

				<CharteEditFooter model={model} />
			</div>
		</div>
	);
}

function CharteEditHeader({ model }: { model: CharteEditForm }) {
	const t = useT();
	return (
		<header className="flex items-center gap-3 px-5 py-4 border-b border-black/5">
			<div className="flex-1 min-w-0">
				<div className="text-xs font-bold text-text-3 uppercase tracking-wider">
					{t("charte_edit_title")}
				</div>
				<div className="text-base font-bold truncate">{model.name}</div>
			</div>
			<button
				type="button"
				onClick={model.onClose}
				aria-label={t("cancel")}
				className="w-8 h-8 rounded-md flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-black/[0.06] transition"
			>
				<X size={16} />
			</button>
		</header>
	);
}

function DescriptionField({ model }: { model: CharteEditForm }) {
	const t = useT();
	return (
		<Field label={t("charte_edit_description")}>
			<input
				value={model.description}
				onChange={(event) => model.setDescription(event.target.value)}
				placeholder={t("charte_edit_description_placeholder")}
				className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
			/>
		</Field>
	);
}

function TokenFields({ model }: { model: CharteEditForm }) {
	const t = useT();
	const labels = {
		add: t("charte_edit_token_add"),
		key: t("charte_edit_token_key"),
		value: t("charte_edit_token_value"),
		remove: t("charte_edit_token_remove"),
	};
	return (
		<section className="flex flex-col gap-3">
			<SectionTitle>{t("charte_edit_tokens")}</SectionTitle>
			{TOKEN_GROUPS.map((group) => (
				<TokenGroup
					key={group}
					model={{
						group,
						label: t(`charte_edit_token_group_${group}`),
						rows: model.tokens[group],
					}}
					actions={tokenGroupActions(model.tokenActions, group)}
					labels={labels}
				/>
			))}
		</section>
	);
}

function tokenGroupActions(
	actions: TokenGroupActionsByGroup,
	group: TokenGroupKey,
): TokenGroupActions {
	return {
		change: (idx, field, value) => actions.change(group, idx, field, value),
		add: () => actions.add(group),
		remove: (idx) => actions.remove(group, idx),
	};
}

function VoiceFieldsSection({ voice }: { voice: VoiceFields }) {
	const t = useT();
	return (
		<section className="flex flex-col gap-3">
			<SectionTitle>{t("charte_edit_voice")}</SectionTitle>
			<Field label={t("charte_edit_voice_personality")}>
				<input
					value={voice.personality}
					onChange={(event) => voice.setPersonality(event.target.value)}
					className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
				/>
			</Field>
			<Field label={t("charte_edit_voice_formality")}>
				<input
					value={voice.formality}
					onChange={(event) => voice.setFormality(event.target.value)}
					className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
				/>
			</Field>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<Field label={t("charte_edit_voice_do")}>
					<textarea
						value={voice.doText}
						onChange={(event) => voice.setDoText(event.target.value)}
						rows={4}
						className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20 resize-y"
					/>
				</Field>
				<Field label={t("charte_edit_voice_dont")}>
					<textarea
						value={voice.dontText}
						onChange={(event) => voice.setDontText(event.target.value)}
						rows={4}
						className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20 resize-y"
					/>
				</Field>
			</div>
		</section>
	);
}

function RulesFields({ rules }: { rules: RuleFields }) {
	const t = useT();
	return (
		<section className="flex flex-col gap-3">
			<SectionTitle>{t("charte_edit_rules")}</SectionTitle>
			<Field label={t("charte_edit_rules_titles")}>
				<textarea
					value={rules.titles}
					onChange={(event) => rules.setTitles(event.target.value)}
					rows={2}
					className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20 resize-y"
				/>
			</Field>
			<Field label={t("charte_edit_rules_photos")}>
				<textarea
					value={rules.photos}
					onChange={(event) => rules.setPhotos(event.target.value)}
					rows={2}
					className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20 resize-y"
				/>
			</Field>
			<Field label={t("charte_edit_rules_layout")}>
				<textarea
					value={rules.layout}
					onChange={(event) => rules.setLayout(event.target.value)}
					rows={2}
					className="w-full px-3 py-2 bg-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20 resize-y"
				/>
			</Field>
		</section>
	);
}

function CharteEditFooter({ model }: { model: CharteEditForm }) {
	const t = useT();
	return (
		<footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-black/5">
			<button
				type="button"
				onClick={model.onClose}
				className="px-4 py-2 rounded-lg text-sm font-semibold text-text-2 hover:bg-black/[0.05] transition"
			>
				{t("cancel")}
			</button>
			<button
				type="button"
				onClick={model.save}
				className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:brightness-110 transition"
			>
				{t("save")}
			</button>
		</footer>
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

interface TokenGroupModel {
	label: string;
	group: TokenGroupKey;
	rows: TokenRow[];
}

interface TokenGroupActions {
	change: (idx: number, field: 0 | 1, value: string) => void;
	add: () => void;
	remove: (idx: number) => void;
}

interface TokenGroupLabels {
	add: string;
	key: string;
	value: string;
	remove: string;
}

interface TokenGroupProps {
	model: TokenGroupModel;
	actions: TokenGroupActions;
	labels: TokenGroupLabels;
}

function TokenGroup({ model, actions, labels }: TokenGroupProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between">
				<span className="text-2xs font-semibold text-text-3 uppercase tracking-wider">
					{model.label}
				</span>
				<button
					type="button"
					onClick={actions.add}
					className="flex items-center gap-1 text-xs font-semibold text-accent hover:brightness-110 transition"
				>
					<Plus size={12} />
					{labels.add}
				</button>
			</div>
			{model.rows.length === 0 ? (
				<div className="text-2xs text-text-3 italic px-1">—</div>
			) : (
				<div className="flex flex-col gap-1.5">
					{model.rows.map((row, idx) => (
						<div key={row.id} className="flex items-center gap-1.5">
							<input
								value={row.key}
								onChange={(e) => actions.change(idx, 0, e.target.value)}
								placeholder={labels.key}
								className="flex-1 px-2.5 py-1.5 bg-input rounded-md text-sm outline-none focus:ring-2 focus:ring-accent/20"
							/>
							<TokenValueInput
								group={model.group}
								value={row.value}
								onChange={(v) => actions.change(idx, 1, v)}
								placeholder={labels.value}
							/>
							<button
								type="button"
								onClick={() => actions.remove(idx)}
								aria-label={
									row.key.trim()
										? `${labels.remove} "${row.key.trim()}"`
										: labels.remove
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
