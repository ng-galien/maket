/**
 * chartes pack — maket_charte (compound).
 *
 * A brand charte (style guide) is a named bundle of design tokens, voice
 * guidelines, and layout rules. `load` also returns a `context_token` — that
 * token is the business-rule proof that the charte was read before any HTML
 * mutation (enforced in maket_html).
 *
 * Deps: `store` (charte CRUD), `bus` (charte:updated), `assets` (charteToken).
 */

import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import { composeCharteCss } from "../lib/charte-css.js";
import type { AssetsService } from "../services/assets.js";
import type { Bus } from "../services/bus.js";
import type { Store } from "../services/store.js";
import type { Charte } from "../types.js";
import { text } from "./_helpers.js";

export interface ChartesDeps {
	store: Store;
	bus: Bus;
	assets: AssetsService;
}

const CharteVoiceSchema = z
	.object({
		personality: z.array(z.string()).optional(),
		formality: z.string().optional(),
		do: z.array(z.string()).optional(),
		dont: z.array(z.string()).optional(),
		vocabulary: z.array(z.string()).optional(),
		examples: z
			.array(
				z.object({
					good: z.string(),
					bad: z.string(),
					context: z.string().optional(),
				}),
			)
			.optional(),
	})
	.optional();

const CharteRulesSchema = z
	.object({
		titles: z.string().optional(),
		photos: z.string().optional(),
		layout: z.string().optional(),
	})
	.passthrough()
	.optional();

const ActionSchema = z.enum(["list", "view", "set", "delete"]);

const MaketCharteSchema = z.object({
	action: ActionSchema.describe(
		"Operation to run. See the tool description for the action table.",
	),
	name: z
		.string()
		.optional()
		.describe("Required for view/set/delete. Unique charte name."),
	description: z
		.string()
		.optional()
		.describe("For set: one-line human description."),
	tokens: z
		.record(z.string(), z.record(z.string(), z.string()))
		.optional()
		.describe(
			'For set: design tokens grouped by category. Become CSS variables --charte-<group>-<key>. Diagram roles can use a canonical "diagram" group (bg, fg, line, accent, muted, surface, border, font, padding, nodeSpacing, layerSpacing, transparent). Example: {"color":{"primary":"#2563EB"},"font":{"body":"Montserrat"},"diagram":{"surface":"#EFF6FF","nodeSpacing":"32px"}}.',
		),
	voice: CharteVoiceSchema.describe(
		"For set: voice guidelines (personality, formality, do/dont, vocabulary, examples).",
	),
	rules: CharteRulesSchema.describe(
		"For set: composition rules (titles, photos, layout). Extra keys allowed.",
	),
});

const DESCRIPTION = [
	"When to use: manage brand style guides (chartes). `view` is a prerequisite for any charte-aware HTML edit — it returns the context_token required by maket_html set/patch.",
	"",
	"Design tokens become CSS variables (--charte-color-primary, etc.) injected into every page. Voice and rules guide content composition.",
	"maket_mermaid automatically consumes canonical diagram tokens and documented fallbacks from color/font groups; its tokenRefs option can target any existing safe token explicitly.",
	"  list   — list all chartes with a short colour-palette preview.",
	"  view   — read one charte; returns tokens, voice, rules, and context_token.",
	"  set    — create or overwrite a charte.",
	"  delete — remove a charte.",
].join("\n");

export function createMaketCharteTool(deps: ChartesDeps): ToolHandler {
	const { store, bus, assets } = deps;
	return {
		metadata: {
			name: "maket_charte",
			description: DESCRIPTION,
			schema: MaketCharteSchema,
		},
		handler: async (rawArgs) => {
			const args = MaketCharteSchema.parse(rawArgs);
			switch (args.action) {
				case "list":
					return runList(store);
				case "view":
					return runView(args, store, assets);
				case "set":
					return runSet(args, store, bus);
				case "delete":
					return runDelete(args, store, bus);
			}
		},
	};
}

type Args = z.infer<typeof MaketCharteSchema>;

function runList(store: Store) {
	const chartes = store.loadAllChartes();
	if (!chartes.length)
		return text(
			"No chartes. Use maket_charte set to define a brand style guide.",
		);
	const lines = chartes.map((c) => {
		const colorPreview = Object.entries(c.tokens?.color || {})
			.slice(0, 5)
			.map(([k, v]) => `${k}:${v}`)
			.join(" ");
		const desc = c.description ? ` — ${c.description}` : "";
		return `- ${c.name}${desc}${colorPreview ? `\n  Colors: ${colorPreview}` : ""}`;
	});
	return text(`Chartes (${chartes.length}):\n${lines.join("\n")}`);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP tool action `runView`: edge adapter over services/store/bus, not domain ownership.
function runView(args: Args, store: Store, assets: AssetsService) {
	if (!args.name) return text("name is required for action=view", true);
	const charte = store.loadCharte(args.name);
	if (!charte) return text(`Charte not found: "${args.name}"`, true);

	const lines: string[] = [
		`Charte: "${charte.name}"${charte.description ? ` — ${charte.description}` : ""}`,
	];
	lines.push("─".repeat(50));

	if (charte.tokens) {
		for (const [group, values] of Object.entries(charte.tokens)) {
			if (!values || typeof values !== "object") continue;
			lines.push(group.toUpperCase());
			for (const [k, v] of Object.entries(values)) {
				lines.push(`  --charte-${group}-${k}: ${v}`);
			}
		}
	}

	if (charte.voice) {
		const v = charte.voice;
		lines.push("VOICE");
		if (v.personality?.length)
			lines.push(`  personality: ${v.personality.join(", ")}`);
		if (v.formality) lines.push(`  formality: ${v.formality}`);
		if (v.do?.length) lines.push(`  do: ${v.do.join(" · ")}`);
		if (v.dont?.length) lines.push(`  dont: ${v.dont.join(" · ")}`);
		if (v.vocabulary?.length)
			lines.push(`  vocabulary: ${v.vocabulary.join(", ")}`);
		if (v.examples?.length) {
			for (const ex of v.examples) {
				lines.push(
					`  ✓ "${ex.good}" / ✗ "${ex.bad}"${ex.context ? ` (${ex.context})` : ""}`,
				);
			}
		}
	}

	if (charte.rules) {
		lines.push("RULES");
		for (const [k, v] of Object.entries(charte.rules)) {
			if (v) lines.push(`  ${k}: ${v}`);
		}
	}

	const token = assets.charteToken(charte);
	if (token) lines.push(`\ncontext_token: ${token}`);

	const next = token
		? [
				`maket_html set doc=<your_doc> page=<N> context_token=${token}`,
				`maket_html patch doc=<your_doc> page=<N> ops=[...]`,
			]
		: undefined;
	return text(lines.join("\n"), next ? { next } : undefined);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP tool action `runSet`: edge adapter over services/store/bus, not domain ownership.
function runSet(args: Args, store: Store, bus: Bus) {
	if (!args.name) return text("name is required for action=set", true);
	const charte: Charte = {
		name: args.name,
		description: args.description,
		tokens: args.tokens ?? {},
	};
	if (args.voice) charte.voice = args.voice;
	if (args.rules) {
		charte.rules = args.rules as unknown as typeof charte.rules;
	}
	store.saveCharte(charte);

	const tokenGroups = Object.keys(args.tokens || {});
	const tokenCount = tokenGroups.reduce(
		(n, g) =>
			n +
			Object.keys(
				(args.tokens as Record<string, Record<string, string>> | undefined)?.[
					g
				] || {},
			).length,
		0,
	);
	const parts = [`${tokenCount} tokens (${tokenGroups.join(", ")})`];
	if (args.voice) parts.push("voice");
	if (args.rules) parts.push("rules");

	bus.emit("charte:updated", {
		name: args.name,
		css: composeCharteCss(charte),
	});
	return text(`Charte "${args.name}" saved — ${parts.join(", ")}`);
}

function runDelete(args: Args, store: Store, bus: Bus) {
	if (!args.name) return text("name is required for action=delete", true);
	const deleted = store.deleteCharte(args.name);
	if (!deleted) return text(`Charte not found: "${args.name}"`, true);
	bus.emit("charte:removed", { name: args.name });
	return text(`Charte "${args.name}" deleted`);
}

export const chartesPack: ToolPack = {
	id: "chartes",
	name: "Chartes (brand style guides)",
	requires: ["store", "bus", "assets"],
	declaresTools: ["maket_charte"],
	register(container) {
		container.register({
			maketCharteTool: asFunction(createMaketCharteTool).singleton(),
		});
	},
};
