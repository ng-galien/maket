export const LEARN_TOPICS = [
	"overview",
	"workflow",
	"tools",
	"html",
	"chartes",
	"diagrams",
	"collections",
	"state",
	"review",
	"install",
	"gemini",
] as const;

export type LearnTopic = (typeof LEARN_TOPICS)[number];
export type LearnAudience = "agent" | "human";

interface LearnSection {
	title: string;
	blocks: string[];
}

interface LearnDocument {
	intro: string;
	sections: LearnSection[];
}

function section(title: string, ...blocks: string[]): LearnSection {
	return { title, blocks };
}

function document(intro: string, ...sections: LearnSection[]): LearnDocument {
	return { intro, sections };
}

const TOPIC_TITLES: Record<LearnTopic, string> = {
	overview: "Maket operating model",
	workflow: "Design workflow",
	tools: "Tool selection",
	html: "HTML composition",
	chartes: "Brand chartes",
	diagrams: "Diagram styling",
	collections: "Collections and placeholders",
	state: "Living document state",
	review: "Review loop",
	install: "MCP installation",
	gemini: "Gemini CLI setup",
};

const AGENT_CONTENT: Record<LearnTopic, LearnDocument> = {
	overview: document(
		"Maket is a live visual workspace driven through MCP tools. The document is the unit of work; the human and the agent share the same persisted content and preview.",
		section(
			"Start every session",
			[
				"1. Read the Learn topics relevant to the request.",
				"2. Inspect the workspace, then focus an existing document or create one.",
				"3. Read current document state before a large edit.",
				"4. Compose or patch one coherent page, validate it, and inspect the preview.",
				"5. Handle pending human feedback before export.",
			].join("\n"),
		),
		section(
			"Tool map",
			[
				"- Session and state: `maket_workspace`",
				"- Document, page, and canvas: `maket_doc`, `maket_page`, `maket_canvas`",
				"- Page content and validation: `maket_html`",
				"- Brand language and diagrams: `maket_charte`, `maket_mermaid`",
				"- Mail merge and living data: `maket_collection`, `maket_state`",
				"- Visual checks and export: `maket_preview`, `maket_pdf`",
			].join("\n"),
		),
		section(
			"Documentation boundary",
			"`maket_learn` is the operational source of truth for agents. The built-in Help document opened from the Maket UI is separate user-facing onboarding; do not recreate it from this tool.",
		),
		section(
			"Next",
			"Call `maket_learn action=topics`, read `tools` when choosing a surface, then read `workflow` plus the focused capability topic.",
		),
	),
	workflow: document(
		"Use one observable loop from workspace inspection to visual validation. Keep changes aligned with the existing design language and the human's latest feedback.",
		section(
			"Preferred loop",
			[
				"1. Call `maket_workspace action=state doc=<doc>` before a large edit.",
				"2. Focus or create the document, then set canvas and metadata.",
				"3. Attach and read the charte when the work is branded.",
				"4. Write one complete page before scattering partial fragments.",
				"5. Call `maket_html action=check` after HTML writes.",
				"6. Inspect the live preview or a snapshot.",
				"7. Read pending messages and patch the smallest coherent correction.",
				"8. Acknowledge a message only after its correction is genuinely handled.",
			].join("\n"),
		),
		section(
			"Names and categories",
			[
				"- Keep names domain-oriented: a document is a document, a page is a page, and a collection member is the business row driving rendered variants.",
				"- Categories may be hierarchical paths such as `clients/acme/proposals`.",
				"- Persist the complete path in `category` with `/` separators; flat categories remain valid roots.",
				"- `maket_doc list` renders the derived hierarchy; there are no persistent folders or empty folder records.",
			].join("\n"),
		),
		section(
			"Next",
			"Read `html` before composing, `chartes` for branded work, or `review` when starting from feedback.",
		),
	),
	tools: document(
		"Maket exposes 14 compound MCP tools. Choose the tool that owns the business capability, then use its action schema for the exact operation.",
		section(
			"Public tool map",
			[
				"| Tool | Responsibility |",
				"| --- | --- |",
				"| `maket_learn` | Operational Markdown documentation for agents |",
				"| `maket_workspace` | Focus, state, locks, and pending human messages |",
				"| `maket_doc` | Document lifecycle, metadata, and portable `.maket` bundles |",
				"| `maket_page` | Page structure: add, remove, rename, reorder, list |",
				"| `maket_canvas` | Format, orientation, background, and print margins |",
				"| `maket_html` | Full HTML writes, surgical patches, reads, and layout checks |",
				"| `maket_charte` | Brand tokens, voice, rules, and CSS context |",
				"| `maket_mermaid` | Charte-aware Mermaid diagrams rendered as inline SVG |",
				"| `maket_collection` | JSON-Schema-backed mail-merge rows and page bindings |",
				"| `maket_state` | Document-owned current data and immutable revisions |",
				"| `maket_image` | Asset import, inspection, metadata, and deletion |",
				"| `maket_preview` | Live preview URL and PNG snapshots |",
				"| `maket_pdf` | PDF export at the real canvas size |",
				"| `maket_gmail` | Gmail connection, read/search when granted, and draft creation |",
			].join("\n"),
		),
		section(
			"Cross-tool boundaries",
			[
				"- Read workspace state before broad changes; mutate documents through their public MCP tools.",
				"- `maket_charte action=view` returns the `context_token` required for charte-aware HTML writes.",
				"- `maket_image action=view` returns the `context_token` required before asset metadata is changed.",
				"- Use `maket_html action=check` for structure and `maket_preview action=snapshot` for visual evidence; neither replaces the other.",
				"- Gmail is draft-only. `maket_gmail` never sends messages; the human reviews and sends in Gmail.",
			].join("\n"),
		),
		section(
			"Next",
			"Read the focused topic for HTML, chartes, diagrams, collections, state, review, or installation before using that capability.",
		),
	),
	html: document(
		"Maket pages are HTML fragments, not full HTML documents. Persist stable, print-oriented structure that can be patched and validated later.",
		section(
			"Authored structure",
			[
				"- Give every meaningful editable element a stable `data-id` and scope CSS inside the fragment.",
				"- Use flex for editorial flow, grid for panels, and absolute positioning only for deliberate overlays.",
				"- Define stable dimensions with mm sizes, grid tracks, `aspect-ratio`, min/max constraints, or constrained flex.",
				"- Keep CSS valid for Chromium PDF export.",
			].join("\n"),
		),
		section(
			"Composition rules",
			[
				"- **Hero:** make the subject or offer the first visual signal with real imagery or a strong typographic block; avoid a decorative card by default.",
				"- **Images:** use real asset-library images with deliberate crop, `object-fit`, `object-position`, and aspect constraints. Do not hide weak crops behind blur, darkness, or generic atmosphere.",
				"- **Typography:** use at most three visible levels, keep body text readable for the format, and use charte font variables when attached.",
				"- **Footer:** reserve it for operational or secondary information, align it to the page grid, and keep it subordinate to the main message.",
				"- Prefer a real asset or generated bitmap over decorative SVG when the image is the subject.",
			].join("\n"),
		),
		section(
			"Layout validation escape hatch",
			'`data-maket-layout="ignore"` excludes exactly one marked non-interactive leaf block from overflow, overlap, clipping, and margin checks. The target must have no child elements or text. Controls, links, `data-maket-bind` elements, focusable elements, and ARIA-role elements are ineligible.',
			"Use it only for an intentional non-content decoration after inspecting a snapshot. It does not apply to descendants and must never hide page structure, text, controls, or uncertain defects.",
			"Do not place it in `action=set` or inside insert, replace, or content HTML. Add it surgically; that enabling operation must be the only operation in the patch request:",
			'```text\nmaket_html action=patch doc=<doc> page=<n> ops=[{"id":"decoration-id","attr":{"data-maket-layout":"ignore"}}]\n```',
			"Then run `maket_html action=check` again.",
		),
		section(
			"Layout measurement report",
			"Run `maket_html action=check doc=<doc> page=<n>` after composition and before export. The returned Markdown report records the physical canvas and total content extents, root position and size, and every problematic addressable block.",
			"For each problem, compare the measured box with both the physical canvas and its nearest `data-id` parent. Per-side excess identifies whether the block escapes the page or only its intended container; clipping and overlap pairs are reported separately.",
			"Treat `overflow` and clipped content as non-shippable. A page can be `ok` even when the application preview was previously wrong; in that case compare the canonical report with a snapshot and fix the preview/runtime mismatch instead of distorting the document.",
		),
		section(
			"Placeholders",
			"Placeholders are template variables inside element content. The renderer wraps resolved placeholders with `data-collection-marker` attributes so the client can locate collection-driven content.",
		),
		section(
			"Next",
			"Read `chartes` before a branded write, `collections` for mail merge, or `state` for interactive data.",
		),
	),
	chartes: document(
		"Chartes encode reusable brand language: design tokens, fonts, voice, and composition rules.",
		section(
			"Workflow",
			[
				"1. Call `maket_charte action=list` before composing branded work.",
				"2. Call `maket_charte action=view name=<name>` to read the charte and receive its `context_token`.",
				"3. Attach it to the document and apply the returned CSS context instead of inventing a parallel palette.",
				"4. If no suitable charte exists, create one from the brief before the final page.",
			].join("\n"),
		),
		section(
			"Diagram tokens",
			"Read `maket_learn action=topic topic=diagrams` for canonical diagram tokens, fallbacks, explicit references, and precedence.",
		),
		section(
			"Next",
			"Read `html` to apply charte CSS or `diagrams` to style Mermaid output.",
		),
	),
	diagrams: document(
		"Use `maket_mermaid` when the content is conceptually a graph. It renders Mermaid to inline SVG for live preview and PDF. An attached document charte is applied automatically.",
		section(
			"Durable diagram contract",
			"Maket stores the Mermaid source and semantic rendering choices on the diagram wrapper. Charte changes rerender these diagrams deterministically, and `.maket` export/import preserves the same source, choices, and SVG result. Existing SVG-only diagrams stay readable and become durable the next time they are replaced with the same `dataId`.",
			"Source-level `classDef`, `class`, `style`, `linkStyle`, and init styling directives are rejected. Express visual intent through charte tokens, `tokenRefs`, or safe direct options.",
		),
		section(
			"Path 1 — reusable diagram tokens",
			"Define defaults in the canonical `diagram` group. Supported keys: `bg`, `fg`, `line`, `accent`, `muted`, `surface`, `border`, `font`, `padding`, `nodeSpacing`, `layerSpacing`, and `transparent`.",
			'```json\n{"diagram":{"bg":"#fffdf5","fg":"#172554","accent":"#ea580c","font":"Inter","nodeSpacing":"36px","transparent":"false"}}\n```',
		),
		section(
			"Path 2 — reuse an existing charte token",
			"Use `tokenRefs` with exact `group.key` references. A charte must be attached. Missing, malformed, or type-incompatible references fail without changing the page.",
			'```json\n{"tokenRefs":{"bg":"color.paper","accent":"color.primary","layerSpacing":"spacing.airy"}}\n```',
		),
		section(
			"Automatic charte lookup",
			[
				"| Role | Lookup order |",
				"| --- | --- |",
				"| `bg` | `diagram.bg` → `color.background` → `color.bg` |",
				"| `fg` | `diagram.fg` → `color.text` → `color.foreground` |",
				"| `line` | `diagram.line` → `color.line` |",
				"| `accent` | `diagram.accent` → `color.accent` → `color.primary` |",
				"| `muted` | `diagram.muted` → `color.muted` |",
				"| `surface` | `diagram.surface` → `color.surface` |",
				"| `border` | `diagram.border` → `color.border` |",
				"| `font` | `diagram.font` → `font.body` |",
				"| spacing and transparency | matching `diagram.*` token only |",
			].join("\n"),
			"Maket never guesses from arbitrary palette tokens.",
		),
		section(
			"Precedence",
			[
				"1. Neutral renderer defaults",
				"2. Document-charte tokens",
				"3. Optional built-in theme profile",
				"4. Explicit `tokenRefs`",
				"5. Direct safe values such as `bg`, `accent`, `font`, spacing, or `transparent`",
			].join("\n"),
			"Direct values are one-off overrides; reusable visual decisions belong in the charte.",
		),
		section(
			"Value types",
			[
				"- Charte spacing accepts a unitless number or `px` value from 0 to 1000.",
				"- Density controls apply to flowchart and state diagrams. The current renderer does not expose reliable density controls for sequence, class, ER, or XY diagrams.",
				'- `transparent` is the string `"true"` or `"false"` in a charte.',
				"- Direct spacing arguments are numbers; direct `transparent` is a boolean.",
				"- Unsafe colour or font syntax is rejected without mutating the page.",
			].join("\n"),
		),
		section(
			"Next",
			"Call `maket_preview action=snapshot` after insertion to verify hierarchy, spacing, labels, and charte alignment.",
		),
	),
	collections: document(
		"Collections are JSON-Schema-backed business resources for ordered mail-merge rows. A bound page can render one member or expand into variants.",
		section(
			"Data workflow",
			[
				"1. Create or inspect the collection schema.",
				"2. Change the schema to add a field; do not infer schema changes from row edits.",
				"3. Add or update rows and validate them against the schema.",
				"4. Bind the intended page before using textual placeholders.",
			].join("\n"),
		),
		section(
			"Shared preview cursor",
			"Every bound page has one server-owned cursor: mode (`template`, `rendered`, or `all`) plus current row.",
			"```text\nmaket_collection action=cursor doc=<doc> page=<n> [mode=<mode>] [row=<row>]\n```",
			"The human canvas, `maket_workspace action=state`, and exports follow the same cursor.",
		),
		section(
			"Export",
			"Use `maket_pdf rows=preview|current|all|template`; all-row mail merge is deliberate, never a hidden default.",
		),
		section(
			"Next",
			"Read `html` for placeholders or `state` when data belongs to one living document.",
		),
	),
	state: document(
		"Document state belongs to one living document. It has one current JSON snapshot and immutable full revisions; unlike a collection, it never expands the page count.",
		section(
			"Choose the right model",
			[
				"| Need | Use |",
				"| --- | --- |",
				"| Ordered rows and mail-merge variants | `maket_collection` |",
				"| One document-owned snapshot with history | `maket_state` |",
			].join("\n"),
		),
		section(
			"Template contract",
			"Author the persistent HTML template and state schema together.",
			[
				"- Supported: escaped values, positive and inverted sections, loops/current context, and comments.",
				"- Root references use `state.*`; relative names are allowed inside positive state sections.",
				"- Examples: `{{ state.title }}`, `{{#state.items}}...{{ label }} / {{ . }}...{{/state.items}}`, and `{{^state.items}}...{{/state.items}}`.",
				"- Invalid: triple braces, partials, lambdas, unscoped root names, and Mustache in attributes, `style`, or `script`.",
			].join("\n"),
		),
		section(
			"Complete minimal example",
			'```html\n<h1 data-id="title">{{ state.title }}</h1>\n<label data-id="done-label"><input data-id="done-input" type="checkbox" data-maket-bind="state.done"> Done</label>\n<input data-id="owner-input" type="text" data-maket-bind="state.owner">\n<select data-id="status-select" data-maket-bind="state.status"><option value="todo">To do</option><option value="done">Done</option></select>\n<button data-id="owner-editor" type="button" data-maket-bind="state.owner">Edit owner</button>\n```',
			'```json\n{"schema":{"type":"object","properties":{"title":{"type":"string"},"done":{"type":"boolean"},"owner":{"type":"string"},"status":{"type":"string","enum":["todo","done"]}},"required":["title","done","owner","status"]},"data":{"title":"Opening","done":false,"owner":"Camille","status":"todo"}}\n```',
			"```text\nmaket_state action=init doc=<doc> schema=<schema> data=<data>\n```",
			"`init` creates revision 1 and does not use `expected_revision`.",
		),
		section(
			"Human-editable controls",
			[
				"- Mustache interpolation is display-only.",
				"- Checkbox binds a boolean; text input binds a string and commits on blur or Enter. Escape cancels.",
				"- Select binds one string enum with exactly one static option per value: no multiple, duplicates, dynamic options, or disabled optgroup coverage.",
				"- `button[type=button]` opens the single-terminal-value editor.",
				"- `data-id` identifies authored structure; it is not a binding.",
				"- Never author or persist `data-maket-path`, `data-maket-type`, `pending`, or `error`.",
				"- The document owns all labels, accessibility, CSS, and native-state styling.",
			].join("\n"),
		),
		section(
			"Schema constraints",
			"Referenced paths use direct `type`, `properties`, and `items`. Do not use `$ref`, `allOf`, `anyOf`, `oneOf`, `not`, or conditionals on those paths. Structural arrays and objects are displayable but not human-editable as one value.",
		),
		section(
			"Revisions and conflicts",
			[
				"1. Call `maket_state action=get` and read `current.revision`.",
				"2. Prefer RFC 6902 `patch`; `update` replaces the full snapshot.",
				"3. `update`, `patch`, `change_schema`, and `restore` require `expected_revision`; `init`, `get`, `validate_schema`, `history`, and `revision` do not.",
				"4. Validate before `change_schema`.",
				"5. On conflict, call `maket_state action=get`, reconcile, and retry with the new revision.",
				"6. Restore appends a revision instead of rewriting history.",
			].join("\n"),
			"Failed template, schema, or data validation is atomic.",
		),
		section(
			"Rendering and portability",
			"Live mode shows hydrated interactive controls. Model/Template mode shows persistent source and is non-interactive. Static output, print, and PDF show the same current values passively, including checked, value, and selected serialization, without mutation behavior.",
			"Portable .maket bundles carry the current schema and data snapshot, like collections carry their current members. Prior state revisions stay local; import initializes the snapshot as revision 1.",
		),
		section(
			"Next",
			"Read `html` for authored structure and `review` before export.",
		),
	),
	review: document(
		"Review is visual and structural. Start from current state and human feedback, then apply the smallest coherent correction.",
		section(
			"Review loop",
			[
				"1. Read workspace state and pending messages without acknowledging them.",
				"2. Run `maket_html action=check` and inspect `maket_preview action=snapshot` when needed.",
				"3. Patch the smallest coherent issue.",
				"4. Re-run structural and visual checks.",
				"5. Acknowledge only messages whose corrections are complete.",
			].join("\n"),
		),
		section(
			"Guardrails",
			[
				"- Do not redesign unless the review exposes a structural defect.",
				"- A passing structural check is not proof of visual quality.",
				"- Do not mark feedback done before applying and verifying the change.",
			].join("\n"),
		),
		section("Next", "Export only after the requested review loop is complete."),
	),
	install: document(
		"Supported agents launch the same Maket MCP bridge. Installation writes client config; the bridge delegates stdio MCP calls to the local HTTP endpoint.",
		section(
			"Install",
			"```sh\nmaket install claude --apply\nmaket install codex --apply\nmaket install gemini --apply\n```",
		),
		section(
			"Verify",
			"Restart or reconnect the client to refresh the tool schema, then call `maket_learn action=overview`.",
		),
		section("Next", "Read `gemini` for Gemini-specific details."),
	),
	gemini: document(
		"Gemini CLI reads MCP servers from `~/.gemini/settings.json` and uses the same bridge as other supported clients.",
		section(
			"Install",
			"```sh\nmaket install gemini --apply\n```",
			"The entry starts `npx -y @ng-galien/maket` in bridge mode.",
		),
		section(
			"Verify",
			"Start Gemini with MCP enabled and call `maket_learn action=overview`.",
		),
	),
};

const HUMAN_CONTENT: Record<LearnTopic, LearnDocument> = {
	overview: document(
		"Maket lets you work with an assistant on visual documents while keeping a live preview open.",
		section(
			"Where to start",
			"The Help button opens the user guide. `maket_learn` is the operational documentation used by assistants.",
		),
	),
	workflow: document(
		"A session starts with a document, a visual goal, optional brand rules, and review notes.",
		section(
			"Shared loop",
			"The assistant reads, changes, checks, handles your notes, and exports when ready.",
		),
	),
	tools: document(
		"Maket tools separate documents, design, data, review, export, and Gmail drafts into explicit capabilities.",
		section(
			"Safety",
			"The assistant uses the tool that owns each capability. Gmail remains draft-only, and you review and send messages yourself.",
		),
	),
	html: document(
		"The assistant writes print-oriented HTML with stable markers.",
		section(
			"Output",
			"The same authored HTML drives live preview, print, and PDF.",
		),
		section(
			"Layout report",
			"The layout check returns a Markdown measurement report with canvas size, content extent, root geometry, and exact excess for problematic elements. It distinguishes page overflow, container overflow, clipping, and overlap.",
		),
	),
	chartes: document(
		"Chartes keep colors, typography, diagrams, voice, and layout consistent.",
		section(
			"Reusable design",
			"Attach one charte so the assistant reuses its tokens instead of recreating the visual language.",
		),
	),
	diagrams: document(
		"Diagrams automatically follow the attached document charte.",
		section(
			"Styling",
			"Reusable styling belongs in the charte; one diagram may also use an existing token or safe local override.",
		),
	),
	collections: document(
		"Collections store structured rows for repeated document variants.",
		section(
			"Shared preview",
			"You, the assistant, and export use the same selected row.",
		),
	),
	state: document(
		"Living documents keep their own structured data and immutable complete revisions.",
		section(
			"Interaction",
			"Live mode exposes authored controls; print and PDF render the same values passively.",
		),
	),
	review: document(
		"Leave comments directly on the document for precise visual context.",
		section(
			"Completion",
			"The assistant applies and verifies each correction before marking it done.",
		),
	),
	install: document(
		"The CLI installs Maket as an MCP server for supported agents.",
		section(
			"After installation",
			"Restart or reconnect the client so it discovers current tools and Learn topics.",
		),
	),
	gemini: document(
		"Gemini uses the same Maket MCP tools as other supported agents.",
		section("Command", "```sh\nmaket install gemini --apply\n```"),
	),
};

export function learnTopicTitle(topic: LearnTopic): string {
	return TOPIC_TITLES[topic];
}

export function learnText(topic: LearnTopic, audience: LearnAudience): string {
	const content = audience === "human" ? HUMAN_CONTENT : AGENT_CONTENT;
	const current = content[topic];
	const sections = current.sections.flatMap(({ title, blocks }) => [
		`## ${title}`,
		...blocks,
	]);
	return [`# ${TOPIC_TITLES[topic]}`, current.intro, ...sections].join("\n\n");
}
