export const LEARN_TOPICS = [
	"overview",
	"workflow",
	"html",
	"chartes",
	"collections",
	"state",
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
	state: "Living document state",
	review: "Review loop",
	install: "MCP installation",
	gemini: "Gemini CLI setup",
};

const AGENT_CONTENT: Record<LearnTopic, string[]> = {
	overview: [
		"Maket is a live visual workspace driven through MCP tools.",
		"Start by reading the current workspace, then create or focus one document, compose HTML with stable data-id markers, and keep the preview open while iterating.",
		"Use maket_workspace for session state, maket_doc for document lifecycle, maket_html for page content, maket_charte for brand language, maket_collection for typed mail-merge data, maket_state for document-owned living data, maket_preview for visual checks, and maket_pdf for final export.",
		"Do not treat this tool as user help content. The user-facing onboarding lives in the built-in Help document opened from the UI.",
	],
	workflow: [
		"Preferred loop: learn the workspace, inspect or create a doc, set canvas and metadata, apply a charte, write one complete page, check layout, review pending user messages, then patch precisely.",
		"Before large edits, call maket_workspace state. After HTML writes, call maket_html check. When the human leaves notes, use maket_workspace list_messages and acknowledge only after the change is genuinely handled.",
		"Document categories may be hierarchical paths such as clients/acme/proposals. Persist the complete path in category with / separators; flat categories remain valid roots, and maket_doc list renders the derived hierarchy. There are no persistent folders or empty folder records.",
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
		'Layout validation escape hatch: data-maket-layout="ignore" excludes exactly the marked non-interactive leaf block from overflow, overlap, clipping, and margin checks. The target must have no child elements or text. Controls, links, data-maket-bind elements, and focusable or ARIA-role elements are ineligible. Use it only for an intentional non-content decoration after inspecting a snapshot; it does not apply to descendants and must never hide page structure, text, controls, or uncertain defects. Do not place it in action=set or inside insert/replace/content HTML. Add it surgically to an existing data-id with maket_html action=patch doc=<doc> page=<n> ops=[{"id":"decoration-id","attr":{"data-maket-layout":"ignore"}}]; that enabling op must be the only operation in the patch request. Then run maket_html action=check again.',
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
		"Every bound page has a shared preview cursor: mode (template, rendered, all) plus current row, owned by the server. Read or move it with maket_collection action=cursor doc=<doc> page=<n> [mode=...] [row=...]. The human's live canvas, maket_workspace state and the exports all follow the same cursor, so 'look at row 3' means the same thing for everyone.",
		"Exports follow the cursor by default. maket_pdf rows=preview|current|all|template makes the choice explicit — 'all rows' mail merge is a deliberate option, not a hidden default.",
	],
	state: [
		"Choose the data model deliberately. Collections hold ordered business rows and can expand one page into mail-merge variants. Document state belongs to one document, has one current JSON snapshot, records immutable full revisions, and never expands the page count.",
		"Author the persistent HTML template and state schema together. Supported Mustache is escaped values, positive sections, inverted sections, loops/current context, and comments: {{ state.title }}, {{#state.items}}...{{ label }} / {{ . }}...{{/state.items}}, and {{^state.items}}...{{/state.items}}. Root references use state.*; relative names are allowed inside positive state sections. Triple braces, partials, lambdas, unscoped root names, and Mustache inside HTML attributes, style, or script are invalid.",
		'Complete minimal example:\n```html\n<h1 data-id="title">{{ state.title }}</h1>\n<label data-id="done-label"><input data-id="done-input" type="checkbox" data-maket-bind="state.done"> Done</label>\n<input data-id="owner-input" type="text" data-maket-bind="state.owner">\n<select data-id="status-select" data-maket-bind="state.status"><option value="todo">To do</option><option value="done">Done</option></select>\n<button data-id="owner-editor" type="button" data-maket-bind="state.owner">Edit owner</button>\n```\n```json\n{"schema":{"type":"object","properties":{"title":{"type":"string"},"done":{"type":"boolean"},"owner":{"type":"string"},"status":{"type":"string","enum":["todo","done"]}},"required":["title","done","owner","status"]},"data":{"title":"Opening","done":false,"owner":"Camille","status":"todo"}}\n```\nCreate a static document and page template, then call maket_state action=init doc=<doc> schema=<schema> data=<data>. Init creates revision 1 and does not use expected_revision.',
		"Mustache interpolation is display-only. Human editing requires document-authored standard HTML and CSS: checkbox binds a boolean; text input binds a string and commits on blur or Enter (Escape cancels); select binds one string enum and must contain exactly one static, selectable option for every enum value (no multiple, duplicate values, dynamic options, or disabled optgroup coverage); button[type=button] opens the single-terminal-value editor. data-id identifies authored structure and is not a binding. Never author or persist data-maket-path, data-maket-type, pending, or error attributes. The document owns all labels, accessibility, CSS, and native-state styling.",
		"Template-referenced schema paths must use direct type, properties, and items declarations. Do not place $ref, allOf, anyOf, oneOf, not, or conditional schema keywords on referenced paths. Structural arrays/objects are displayable through sections but are never human-editable as one value.",
		"Revision workflow: call get and read current.revision; update replaces the complete data snapshot, while patch applies RFC 6902 operations and is the preferred agent path for precise or structural changes. update, patch, change_schema, and restore require expected_revision; init, get, validate_schema, history, and revision do not. Validate a proposed schema first, then change_schema with compatible data. Restore appends a new revision instead of rewriting history.",
		"On a revision conflict, call maket_state action=get, reconcile or recalculate the intended change against current.data, and retry with the new current.revision. Failed template, schema, or data validation is atomic and leaves the persisted template and state unchanged.",
		"The canvas Live mode shows hydrated interactive controls. Model/Template mode shows the persistent source and is non-interactive. Static rendered output, print, and PDF render the same current values passively, including checked/value/selected serialization, without mutation behavior. Portable .maket bundles carry the current schema and data snapshot, like collections carry their current members; prior state revisions stay local, and import initializes the snapshot as revision 1.",
	],
	review: [
		"Review is visual and structural. Use maket_preview snapshot or maket_html check, inspect user notes, and fix the smallest coherent design issue.",
		"Do not acknowledge pending messages before the corresponding correction is applied. Do not redesign when the request is a review unless the defect is structural.",
	],
	install: [
		"Supported agents should all launch the same Maket MCP bridge. The install command writes client config; the bridge serves MCP over the SDK's stdio transport and delegates tools to the local HTTP MCP endpoint.",
		"Use maket install claude --apply, maket install codex --apply, or maket install gemini --apply.",
	],
	gemini: [
		"Gemini CLI reads MCP servers from ~/.gemini/settings.json.",
		"Run maket install gemini --apply to add the maket server entry. The entry starts npx -y @ng-galien/maket in bridge mode, matching the other supported agent setups.",
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
	state: [
		"Living documents keep their own structured data and an immutable history of complete revisions, independently from mail-merge collections.",
	],
	review: [
		"Leave comments on the document. The assistant reads them from Maket, applies corrections, and marks them done.",
	],
	install: ["The CLI can install Maket as an MCP server for supported agents."],
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
