export const LEARN_TOPICS = [
	"overview",
	"workflow",
	"html",
	"chartes",
	"collections",
	"review",
	"install",
	"gemini",
] as const;

export type LearnTopic = (typeof LEARN_TOPICS)[number];

export type LearnAudience = "agent" | "human";

const TOPIC_TITLES: Record<LearnTopic, string> = {
	overview: "Maket operating model",
	workflow: "Design workflow",
	html: "HTML composition",
	chartes: "Brand chartes",
	collections: "Collections and placeholders",
	review: "Review loop",
	install: "MCP installation",
	gemini: "Gemini CLI setup",
};

const AGENT_CONTENT: Record<LearnTopic, string[]> = {
	overview: [
		"Maket is a live visual workspace driven through MCP tools.",
		"Start by reading the current workspace, then create or focus one document, compose HTML with stable data-id markers, and keep the preview open while iterating.",
		"Use maket_workspace for session state, maket_doc for document lifecycle, maket_html for page content, maket_charte for brand language, maket_collection for typed placeholder data, maket_preview for visual checks, and maket_pdf for final export.",
		"Do not treat this tool as user help content. The user-facing onboarding lives in the built-in Help document opened from the UI.",
	],
	workflow: [
		"Preferred loop: learn the workspace, inspect or create a doc, set canvas and metadata, apply a charte, write one complete page, check layout, review pending user messages, then patch precisely.",
		"Before large edits, call maket_workspace state. After HTML writes, call maket_html check. When the human leaves notes, use maket_workspace list_messages and acknowledge only after the change is genuinely handled.",
		"Keep names domain-oriented. A document is a document, a page is a page, a collection member is the business row driving rendered variants.",
	],
	html: [
		"Maket pages are authored as HTML fragments, not full HTML documents.",
		"Every meaningful editable element needs a stable data-id. Use semantic wrappers and CSS scoped inside the page fragment. Prefer flex or grid with explicit dimensions in mm for predictable print output.",
		"Choose one layout system for the page: flex for vertical editorial flow, grid for panels and comparison, absolute positioning only for deliberate overlays, scrims, or image/text layering.",
		"Hero composition: the first viewport signal must carry the subject or offer. Use real imagery or a strong typographic block, then leave enough structure below it for context. Hero text sits on the scene or in the layout, not in a decorative card by default.",
		"Images are content, not fillers. Use asset-library images with object-fit, object-position, aspect constraints, and a crop that preserves the subject. Do not hide weak crops behind blur, darkness, or generic atmospheric treatment.",
		"Footer composition: reserve it for operational or secondary information such as date, source, contact, legal, page number, or document context. It must not compete with the main message, and it should align to the page grid.",
		"Stable dimensions matter. Define page, sections, image frames, counters, and repeated items with fixed mm sizes, grid tracks, aspect-ratio, min/max, or constrained flex rules so content changes do not shift the layout unpredictably.",
		"Typography is hierarchy. Use at most three visible text levels on a simple page, keep body text readable for the target format, and use charte font variables when a charte is attached.",
		"Keep CSS values valid for Chromium PDF export. Use real image URLs from the asset library. Avoid decorative SVG when a real asset or generated bitmap is the subject.",
		"Placeholders are template variables inside element content. The renderer wraps resolved placeholders with data-collection-marker attributes so the front can locate collection-driven content reliably.",
	],
	chartes: [
		"Chartes encode brand language: color tokens, fonts, voice, and composition rules.",
		"Use maket_charte list and view before composing branded work. Apply the returned CSS context in your page HTML instead of inventing a parallel palette.",
		"If no charte exists, create one from the brief before designing the final page.",
	],
	collections: [
		"Collections are business data resources. A collection owns a JSON Schema and ordered members; pages can bind to a collection and render against the selected member or all members.",
		"Change data through maket_collection actions. To add a field, change the schema; to edit values, add or update rows. Validate schema and rows rather than treating placeholders as loose strings.",
		"Use placeholders for textual values only when the page is bound to the collection that owns the field.",
	],
	review: [
		"Review is visual and structural. Use maket_preview snapshot or maket_html check, inspect user notes, and fix the smallest coherent design issue.",
		"Do not acknowledge pending messages before the corresponding correction is applied. Do not redesign when the request is a review unless the defect is structural.",
	],
	install: [
		"Claude, Codex, and Gemini should all launch the same Maket MCP bridge. The install command writes client config; the bridge then proxies stdio JSON-RPC to the local HTTP MCP endpoint.",
		"Use maket install claude --apply, maket install codex --apply, or maket install gemini --apply.",
	],
	gemini: [
		"Gemini CLI reads MCP servers from ~/.gemini/settings.json.",
		"Run maket install gemini --apply to add the maket server entry. The entry starts npx -y @ng-galien/maket in bridge mode, matching the Claude and Codex setup.",
		"After install, start Gemini with MCP enabled and ask it to call maket_learn action=overview.",
	],
};

const HUMAN_CONTENT: Record<LearnTopic, string[]> = {
	overview: [
		"Maket lets you work with an assistant on visual documents while keeping a live preview open.",
		"The Help button opens a normal Maket document that explains the human workflow. This MCP tool is for assistants learning how to operate Maket correctly.",
	],
	workflow: [
		"A practical session starts with a document, a visual goal, optional brand rules, and review notes directly on the preview.",
		"The assistant can read your notes, update the document, and export once the layout is ready.",
	],
	html: [
		"The assistant writes print-oriented HTML. Stable markers let Maket identify editable areas and collection-driven placeholders.",
	],
	chartes: [
		"Brand chartes keep colors, typography, voice, and layout rules consistent across documents.",
	],
	collections: [
		"Collections store structured data that can drive repeated document variants, such as names, dates, places, or product details.",
	],
	review: [
		"Leave comments on the document. The assistant reads them from Maket, applies corrections, and marks them done.",
	],
	install: [
		"The CLI can install Maket as an MCP server for Claude, Codex, or Gemini.",
	],
	gemini: [
		"Gemini users can run maket install gemini --apply, then use Maket tools from the Gemini CLI.",
	],
};

export function learnTopicTitle(topic: LearnTopic): string {
	return TOPIC_TITLES[topic];
}

export function learnText(topic: LearnTopic, audience: LearnAudience): string {
	const content = audience === "human" ? HUMAN_CONTENT : AGENT_CONTENT;
	return [`# ${TOPIC_TITLES[topic]}`, "", ...content[topic]].join("\n");
}
