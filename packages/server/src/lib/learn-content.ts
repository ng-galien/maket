export const LEARN_TOPICS = [
	"overview",
	"workflow",
	"tools",
	"html",
	"chartes",
	"diagrams",
	"collections",
	"state",
	"structured-workspaces",
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
	"structured-workspaces": "Structured Workspaces",
	review: "Review loop",
	install: "MCP installation",
	gemini: "Gemini CLI setup",
};

/** One call of the Structured Workspace method: the exact arguments, what
 * the answer contains verbatim, and what to verify before going on. */
export interface WorkspaceMethodStep {
	tool: "maket_structured_workspace" | "maket_doc" | "maket_html";
	purpose: string;
	args: Record<string, unknown>;
	answer: string[];
	verify: string;
}

export interface WorkspaceMethodPath {
	title: string;
	when: string;
	steps: WorkspaceMethodStep[];
}

/** One failure the method can meet: the call that meets it, the sentence the
 * agent reads verbatim, the reason, and the correcting call. */
export interface WorkspaceFailure {
	title: string;
	/** Calls that lead to it, run in order on a fresh Maket. A step named
	 * `edit-template` or `move-template` stands for a manual change,
	 * `open-item` for the user opening an item in Maket. */
	steps: Array<
		| Pick<WorkspaceMethodStep, "tool" | "args">
		| {
				manual: "edit-template" | "move-template" | "open-item";
				document: string;
		  }
	>;
	seen: string;
	why: string;
	fix: string;
}

const READING_SCHEMA = {
	type: "object",
	properties: {
		title: { type: "string" },
		author: { type: "string" },
		year: { type: "integer" },
		status: { type: "string", enum: ["to read", "reading", "done"] },
	},
	required: ["title", "status"],
	additionalProperties: false,
};

const RECIPE_SCHEMA = {
	type: "object",
	properties: {
		title: { type: "string" },
		minutes: { type: "integer" },
		vegetarian: { type: "boolean" },
	},
	required: ["title", "minutes"],
	additionalProperties: false,
};

const TEAM_SCHEMA = {
	type: "object",
	properties: {
		name: { type: "string" },
		role: { type: "string" },
	},
	required: ["name", "role"],
	additionalProperties: false,
};

const TEAM_TEMPLATES = [
	{
		doc: "Team index",
		html: '<main data-id="index"><h1 data-id="heading">Team</h1><section data-id="cards" data-maket-structured-items></section></main>',
	},
	{
		doc: "Team member",
		html: '<article data-id="member"><h1 data-id="name">{{ state.name }}</h1><p data-id="role">{{ state.role }}</p></article>',
	},
	{
		doc: "Team card",
		html: '<article data-id="card" data-maket-compact-root><strong data-id="card-name">{{ state.name }}</strong></article>',
	},
];

export const STRUCTURED_WORKSPACE_METHOD: WorkspaceMethodPath[] = [
	{
		title: "Path 1 — data schema alone (use it by default)",
		when: "Use it whenever no template design is imposed: Maket writes the index, detail, card templates and the detail form from the data schema.",
		steps: [
			{
				tool: "maket_structured_workspace",
				purpose: "Create the Workspace from its data schema only.",
				args: {
					action: "create",
					workspace: "Reading list",
					data_schema: READING_SCHEMA,
				},
				answer: [
					'Structured Workspace "Reading list" created',
					"Verdict: ready.",
					"Collections: items (bindings: item).",
					'Template documents in category "Structured Workspaces/Reading list": "Reading list — Items — index template", "Reading list — Items — detail template", "Reading list — Items — card template".',
				],
				verify:
					"The answer says `Verdict: ready.` and is not an error. Note the collection id (`items`) and the binding id (`item`): add_item needs both.",
			},
			{
				tool: "maket_structured_workspace",
				purpose: "Add the first item; its data must satisfy the data schema.",
				args: {
					action: "add_item",
					workspace: "Reading list",
					collection: "items",
					binding: "item",
					document_name: "Dune",
					data: {
						title: "Dune",
						author: "Frank Herbert",
						year: 1965,
						status: "reading",
					},
				},
				answer: ['at data revision 1; it opens as document "Dune".'],
				verify:
					"The answer names the item document. An answer starting with `Item data breaks the schema` lists each wrong path with its fix: correct `data` and call add_item again.",
			},
			{
				tool: "maket_structured_workspace",
				purpose:
					"Run the doctor before telling the user the Workspace is ready.",
				args: { action: "check", workspace: "Reading list" },
				answer: ['"verdict": "ready"'],
				verify:
					'`verdict` is `ready`. Otherwise apply the `fix` and the `next` call of every finding whose `severity` is `error`, then call check again. Findings of severity `warning` and `hint` do not block "ready" but say what the user will miss.',
			},
		],
	},
	{
		title: "Path 2 — templates inline in the create call",
		when: "Use it when the detail page, the card or the index must look a given way. Give the HTML in the call; Maket creates and names the template documents itself.",
		steps: [
			{
				tool: "maket_structured_workspace",
				purpose:
					"Create the Workspace with its detail HTML, card HTML, index HTML and detail form inline.",
				args: {
					action: "create",
					workspace: "Recipes",
					data_schema: RECIPE_SCHEMA,
					representation_schema: {
						collections: {
							recipes: {
								name: "Recipes",
								sortBy: "/minutes",
								indexTemplateHtml:
									'<main data-id="index"><h1 data-id="heading">Recipes</h1><section data-id="cards" data-maket-structured-items></section></main>',
								detailTemplateHtml:
									'<article data-id="recipe"><h1 data-id="name">{{ state.title }}</h1><p data-id="time">{{ state.minutes }} min</p></article>',
								compactTemplateHtml:
									'<article data-id="card" data-maket-compact-root><strong data-id="card-title">{{ state.title }}</strong> <span data-id="card-time">{{ state.minutes }} min</span></article>',
								detailForm: {
									uischema: {
										type: "VerticalLayout",
										elements: [
											{ type: "Control", scope: "#/properties/minutes" },
											{ type: "Control", scope: "#/properties/vegetarian" },
										],
									},
								},
							},
						},
					},
				},
				answer: [
					'Structured Workspace "Recipes" created',
					"Verdict: ready.",
					"Collections: recipes (bindings: item).",
					'Template documents in category "Structured Workspaces/Recipes": "Recipes — Recipes — index template", "Recipes — Recipes — detail template", "Recipes — Recipes — card template".',
				],
				verify:
					"`Verdict: ready.`; the binding id is `item` because the collection declares no bindings.",
			},
			{
				tool: "maket_structured_workspace",
				purpose: "Add the first item.",
				args: {
					action: "add_item",
					workspace: "Recipes",
					collection: "recipes",
					binding: "item",
					document_name: "Pancakes",
					data: { title: "Pancakes", minutes: 20, vegetarian: true },
				},
				answer: ['at data revision 1; it opens as document "Pancakes".'],
				verify: "The answer names the item document.",
			},
			{
				tool: "maket_structured_workspace",
				purpose: "Run the doctor.",
				args: { action: "check", workspace: "Recipes" },
				answer: ['"verdict": "ready"'],
				verify: "`verdict` is `ready`.",
			},
		],
	},
	{
		title: "Path 3 — template documents created beforehand and named",
		when: "Use it only to reuse template documents that already exist or must be authored page by page. Create, fill and bind them in the same session.",
		steps: [
			...TEAM_TEMPLATES.map(
				(template): WorkspaceMethodStep => ({
					tool: "maket_doc",
					purpose: `Create the template document "${template.doc}".`,
					args: { action: "new", doc: template.doc, format: "A4" },
					answer: [`New doc "${template.doc}" [general]`],
					verify:
						"The document exists. It sits in the Documents library only until the create step binds it.",
				}),
			),
			...TEAM_TEMPLATES.map(
				(template): WorkspaceMethodStep => ({
					tool: "maket_html",
					purpose: `Write page 1 of "${template.doc}".`,
					args: {
						action: "set",
						doc: template.doc,
						page: 1,
						html: template.html,
					},
					answer: [],
					verify: "The page is written without error.",
				}),
			),
			{
				tool: "maket_structured_workspace",
				purpose:
					"Create the Workspace and bind the three documents by exact name.",
				args: {
					action: "create",
					workspace: "Team",
					data_schema: TEAM_SCHEMA,
					representation_schema: {
						collections: {
							people: {
								name: "People",
								collectionTemplateDocumentId: "Team index",
								bindings: {
									member: {
										schemaPath: "",
										detailTemplateDocumentId: "Team member",
										compactTemplateDocumentId: "Team card",
									},
								},
							},
						},
					},
				},
				answer: [
					'Structured Workspace "Team" created',
					"Verdict: ready.",
					"Collections: people (bindings: member).",
					'Template documents in category "Structured Workspaces/Team": "Team index", "Team member", "Team card".',
				],
				verify:
					"`Verdict: ready.` and the three names are listed under the Workspace category: they left the Documents library.",
			},
			{
				tool: "maket_structured_workspace",
				purpose: "Add the first item.",
				args: {
					action: "add_item",
					workspace: "Team",
					collection: "people",
					binding: "member",
					document_name: "Ada",
					data: { name: "Ada", role: "Engineer" },
				},
				answer: ['at data revision 1; it opens as document "Ada".'],
				verify: "The answer names the item document.",
			},
			{
				tool: "maket_structured_workspace",
				purpose: "Run the doctor.",
				args: { action: "check", workspace: "Team" },
				answer: ['"verdict": "ready"'],
				verify: "`verdict` is `ready`.",
			},
		],
	},
];

const createReading = (representation?: unknown) => ({
	tool: "maket_structured_workspace" as const,
	args: {
		action: "create",
		workspace: "Reading list",
		data_schema: READING_SCHEMA,
		...(representation === undefined
			? {}
			: { representation_schema: representation }),
	},
});

const addDune = {
	tool: "maket_structured_workspace" as const,
	args: {
		action: "add_item",
		workspace: "Reading list",
		collection: "items",
		binding: "item",
		document_name: "Dune",
		data: { title: "Dune", status: "reading" },
	},
};

const checkReading = {
	tool: "maket_structured_workspace" as const,
	args: { action: "check", workspace: "Reading list" },
};

export const STRUCTURED_WORKSPACE_FAILURES: WorkspaceFailure[] = [
	{
		title: "A named template document does not exist",
		steps: [
			createReading({
				collections: {
					items: {
						name: "Items",
						collectionTemplateDocumentId: "Reading index",
					},
				},
			}),
		],
		seen: 'No document is named or identified "Reading index".',
		why: "The name is not the exact name of an existing document (typo, or the document was never created).",
		fix: "Call create again without collectionTemplateDocumentId: Maket writes the template.",
	},
	{
		title: "A collection without binding",
		steps: [
			createReading({
				collections: { items: { name: "Items", bindings: {} } },
			}),
		],
		seen: 'Collection "items" must declare at least one binding.',
		why: "`bindings` is present but empty, so no item can be added.",
		fix: "Call create again without `bindings` (Maket binds the whole schema as `item`).",
	},
	{
		title: "A placeholder names a path absent from the schema",
		steps: [
			createReading({
				collections: {
					items: {
						name: "Items",
						detailTemplateHtml: '<h1 data-id="title">{{ state.titel }}</h1>',
					},
				},
			}),
		],
		seen: 'Placeholder "state.titel" names a path the state schema does not declare.',
		why: "Placeholders read item data; `titel` is not a property of the data schema.",
		fix: "Call create again with `{{ state.title }}`, a declared property, or declare the property in data_schema.",
	},
	{
		title: "A form field on a missing path",
		steps: [
			createReading({
				collections: {
					items: {
						name: "Items",
						detailForm: {
							uischema: {
								type: "VerticalLayout",
								elements: [{ type: "Control", scope: "#/properties/isbn" }],
							},
						},
					},
				},
			}),
		],
		seen: 'JSON Pointer target does not exist: "/properties/isbn".',
		why: "Every form Control `scope` must point at a property of the data schema.",
		fix: 'Call create again with scopes of declared properties, such as "#/properties/status".',
	},
	{
		title: "A form slot in the detail HTML",
		steps: [
			createReading({
				collections: {
					items: {
						name: "Items",
						detailTemplateHtml:
							'<article data-id="book"><h1 data-id="title">{{ state.title }}</h1><!--maket-json-form--></article>',
					},
				},
			}),
		],
		seen: "The page has a <!--maket-json-form--> slot but no form definition.",
		why: "Maket places detailForm on its own page; a slot in the HTML stays empty.",
		fix: "Call create again without the `<!--maket-json-form-->` comment, giving the form in detailForm.",
	},
	{
		title: "groupBy or sortBy names no property",
		steps: [
			createReading({
				collections: { items: { name: "Items", groupBy: "/genre" } },
			}),
		],
		seen: 'Collection "items" groupBy "/genre" names no property of the data schema.',
		why: "The index groups and sorts by item data; `/genre` is not declared.",
		fix: 'Call create again with groupBy "/status" (a declared property), or declare genre in data_schema.',
	},
	{
		title: "The data schema is not a JSON Schema",
		steps: [
			{
				tool: "maket_structured_workspace",
				args: {
					action: "create",
					workspace: "Reading list",
					data_schema: { type: "strin" },
				},
			},
		],
		seen: "Invalid data schema/type: must be equal to one of the allowed values",
		why: "`type` must be a JSON Schema type such as object, string, integer, boolean.",
		fix: 'Call create again with data_schema {"type":"object","properties":{…}}.',
	},
	{
		title: "An item breaks the schema",
		steps: [
			createReading(),
			{
				tool: "maket_structured_workspace",
				args: {
					action: "add_item",
					workspace: "Reading list",
					collection: "items",
					binding: "item",
					document_name: "Dune",
					data: { title: "Dune", status: "reading", year: "1965" },
				},
			},
		],
		seen: "- /year [rule type]: Invalid item data/year: must be integer. Fix: Give /year a value of type integer.",
		why: "Item data is validated against the data schema; no document is created.",
		fix: "Call add_item again with corrected data (here year: 1965).",
	},
	{
		title: "A Workspace with no item",
		steps: [createReading(), checkReading],
		seen: 'Workspace "Reading list" has no item yet.',
		why: "A hint, not an error: the index is empty until the first add_item.",
		fix: "Call the add_item given as `next` in the finding.",
	},
	{
		title: "Template pages out of sync",
		steps: [
			createReading(),
			addDune,
			{ manual: "open-item", document: "Dune" },
			{
				manual: "edit-template",
				document: "Reading list — Items — detail template",
			},
			checkReading,
		],
		seen: 'Template-controlled pages of collection "items" differ from their templates.',
		why: "A template document was edited after an item was opened, which instantiated its document.",
		fix: "Call sync_template with the workspace and collection given as `next`.",
	},
	{
		title: "A template document outside the Workspace category",
		steps: [
			createReading(),
			{
				manual: "move-template",
				document: "Reading list — Items — card template",
			},
			checkReading,
		],
		seen: 'sits in category "general", outside the Workspace category "Structured Workspaces/Reading list".',
		why: "A template was moved out of the Workspace category.",
		fix: "Call view on the Workspace: it files every template back in the Workspace category.",
	},
	{
		title: "A template document owned by another Workspace",
		steps: [
			createReading(),
			{
				tool: "maket_structured_workspace",
				args: {
					action: "create",
					workspace: "Second list",
					data_schema: READING_SCHEMA,
					representation_schema: {
						collections: {
							items: {
								name: "Items",
								collectionTemplateDocumentId:
									"Reading list — Items — index template",
							},
						},
					},
				},
			},
		],
		seen: 'Template document "Reading list — Items — index template" is owned by another resource.',
		why: "A template belongs to exactly one Workspace.",
		fix: "Call create again without collectionTemplateDocumentId: Maket writes a template for this Workspace.",
	},
];

function parameterType(value: unknown): string {
	if (Array.isArray(value)) return "array";
	if (value === null) return "null";
	if (typeof value === "number")
		return Number.isInteger(value) ? "integer" : "number";
	return typeof value;
}

const OBJECT_PARAMETERS: Record<string, string> = {
	data_schema:
		"the JSON Schema of one item, an object with `type`, `properties`, `required`; see the JSON call",
	data: "one item, valid against data_schema; see the JSON call",
	representation_schema:
		"collections and their templates, fields listed under Method; see the JSON call",
};

function renderMethodStep(step: WorkspaceMethodStep, index: number): string {
	const action = String(step.args.action);
	const parameters = Object.entries(step.args).map(([name, value]) =>
		typeof value === "object" && value !== null
			? `   - \`${name}\` (${parameterType(value)}): ${OBJECT_PARAMETERS[name] ?? "see the JSON call"}`
			: `   - \`${name}\` (${parameterType(value)}): \`${JSON.stringify(value)}\``,
	);
	return [
		`${index + 1}. ${step.purpose} Call \`${step.tool}\` action \`${action}\`:`,
		...parameters,
		"",
		"   ```json",
		`   ${JSON.stringify(step.args)}`,
		"   ```",
		step.answer.length
			? `   The answer contains: ${step.answer.map((line) => `\`${line}\``).join(" · ")}`
			: "   The answer is a success, not an error.",
		`   Verify: ${step.verify}`,
	].join("\n");
}

function methodSections(): LearnSection[] {
	return STRUCTURED_WORKSPACE_METHOD.map((path) =>
		section(
			path.title,
			path.when,
			path.steps.map(renderMethodStep).join("\n\n"),
		),
	);
}

function failureSection(): LearnSection {
	return section(
		"When it fails",
		'create and update_definition refuse a definition with errors: the answer is an MCP error whose first line says the Workspace was not created (or keeps its definition), then one line per error `- collection "<id>" · <path>: <sentence> Fix: <fix>`, then `next:` calls. Nothing is persisted; fix every line and call again. `allow_incomplete=true` persists an incomplete definition on purpose; check then lists what remains. Every case below is what an agent reads verbatim.',
		STRUCTURED_WORKSPACE_FAILURES.map(
			(failure, index) =>
				`${index + 1}. ${failure.title}.\n   Seen: \`${failure.seen}\`\n   Why: ${failure.why}\n   Fix: ${failure.fix}`,
		).join("\n"),
	);
}

/** The first path of the Structured Workspace method in five lines, repeated
 * by the gemini topic and the plugin skills. */
export const STRUCTURED_WORKSPACE_FIRST_PATH = [
	'1. maket_structured_workspace {"action":"create","workspace":"<name>","data_schema":<JSON Schema object>}',
	"2. Read the answer: `Verdict: ready.`, the collection id `items` and the binding id `item`.",
	'3. maket_structured_workspace {"action":"add_item","workspace":"<name>","collection":"items","binding":"item","document_name":"<item name>","data":<item JSON>}',
	'4. maket_structured_workspace {"action":"check","workspace":"<name>"} must answer "verdict": "ready".',
	"5. On an error answer, apply every `Fix:` line and call again; the full method: maket_learn action=topic topic=structured-workspaces.",
].join("\n");

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
				"- Schema-driven document collections: `maket_structured_workspace`",
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
				"For a continuous document, use `maket_doc action=new format=AUTO width=<mm>` or `maket_canvas format=AUTO width=<mm>`. Width stays fixed; each page height follows normal-flow HTML. Do not impose a fixed-height wrapper. AUTO state lists stay on the same continuous page; snapshots, thumbnails, print and PDF follow content height.",
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
		"Maket exposes 15 compound MCP tools. Choose the tool that owns the business capability, then use its action schema for the exact operation.",
		section(
			"Public tool map",
			[
				"| Tool | Responsibility |",
				"| --- | --- |",
				"| `maket_learn` | Operational Markdown documentation for agents |",
				"| `maket_workspace` | Focus, state, locks, and pending human messages |",
				"| `maket_doc` | Document lifecycle, side-effect-free lookup by exact name, metadata, pins, and portable `.maket` bundles |",
				"| `maket_page` | Page structure: add, remove, rename, reorder, list |",
				"| `maket_canvas` | Format, orientation, background, and print margins |",
				"| `maket_html` | Full HTML writes, surgical patches, reads, and layout checks |",
				"| `maket_charte` | Brand tokens, voice, rules, and CSS context |",
				"| `maket_mermaid` | Charte-aware Mermaid diagrams rendered as inline SVG |",
				"| `maket_collection` | JSON-Schema-backed mail-merge rows and page bindings |",
				"| `maket_state` | Document-owned current data, immutable revisions, and revision retention |",
				"| `maket_structured_workspace` | Schema-driven collections of persistent instantiated documents |",
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
				"- `maket_doc action=pin doc=<name>` keeps a document the user consults daily at the top of the desktop document list, the Reader navigation, and `maket_doc list`, most recently pinned first; `action=unpin` returns it to its category.",
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
			"The check measures the page as readers see it. A state-backed page is hydrated with the current document state and a collection page with the member its preview cursor shows (the first member otherwise); the report's first line names that data. Other pages are measured as authored. Set and patch measure the same way, so a state-backed layout can be verified without a PDF or PNG snapshot.",
		),
		section(
			"Placeholders",
			"Placeholders are template variables inside element content. The renderer wraps resolved placeholders with `data-collection-marker` attributes so the client can locate collection-driven content.",
		),
		section(
			"Drawing from document state",
			[
				"- On a state-backed page, an escaped `{{ state.* }}` value (or a relative value inside a state section) may sit inside a quoted presentation attribute; every other attribute stays refused.",
				"- SVG elements accept state values in `x`, `y`, `width`, `height`, `r`, `rx`, `ry`, `cx`, `cy`, `x1`, `y1`, `x2`, `y2`, `points`, `viewBox`, `d`, `transform`, `opacity`, `fill-opacity`, `stroke-width`, `stroke-dasharray`, and `stroke-dashoffset`.",
				"- Any element accepts state values in its `style` attribute only as the value of `width`, `height`, `left`, `top`, `transform`, or `opacity`.",
				"- The rendered value must be a number or length (`px`, `%`, `em`, `rem`, `mm`, `cm`, `in`, `pt`, …); a number or percentage for opacities; four numbers for `viewBox`; an even number list for `points`; `none` or lengths for `stroke-dasharray`; path data of numbers and `M L H V C S Q T A Z` commands starting with `M` for `d`; transform functions `translate`, `translateX`, `translateY`, `scale`, `scaleX`, `scaleY`, `rotate`, `skewX`, `skewY`, `matrix` with numeric, length, or angle arguments for `transform`.",
				"- Any other rendered value fails the write or the state change with an issue naming the element and attribute. `url(`, `expression(`, script or data URLs, escapes, and markup in a templated attribute are refused before persistence. Such a tag cannot also carry `data-maket-bind`.",
				"- Re-renders update the existing elements in place, so an author CSS `transition` on the attribute or property animates the change; no script is involved. Print, PDF, and snapshots render the same values.",
			].join("\n"),
			'```html\n<svg data-id="chart" viewBox="0 0 100 40">\n  {{#state.bars}}<rect y="{{ y }}" height="8" width="{{ value }}" style="transition: width 400ms ease"/>{{/state.bars}}\n</svg>\n<div data-id="gauge" style="width: {{ state.ratio }}%; transition: width 400ms"></div>\n```',
		),
		section(
			"Links between pages",
			[
				"- A link to another page of the same document is a plain anchor. The canonical form is `#page=<n>` with the 1-based page number; `#page:<exact page name>` is also accepted and keeps working when pages are reordered (the first page carrying that name wins).",
				"- The connected Reader and the standalone viewer navigate to that page on a plain click. In the authoring Canvas a plain click on the link, or on a block it wraps, selects it for editing; ⌘-click (Ctrl-click outside Apple platforms) follows it and fits the view on the target page.",
				"- Print and PDF turn it into an internal link to the first printed page of the target (a collection template page expands into several printed pages).",
				"- The href is a literal. `maket_html` set and patch and `maket_page` add refuse Mustache in a page link such as `#page={{ n }}`, naming the element. Any element may sit inside the anchor; style it like any other link.",
				"- `maket_html action=check` lists every page link that targets no page of the document with its `data-id`, including a Mustache target that reached the page another way.",
			].join("\n"),
			'```html\n<nav data-id="nav">\n  <a data-id="nav-detail" href="#page=3">Details</a>\n  <a data-id="nav-summary" href="#page:Summary">Summary</a>\n</nav>\n```',
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
		"Document state belongs to one living document. It has one current JSON snapshot and immutable full revisions; unlike a collection, it never expands into variants. On fixed-height canvases, a list longer than its page continues on generated pages; on AUTO canvases it stays on one continuous page.",
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
			"A page uses HTML, JSON Forms, or an HTML template with one <!--maket-json-form--> slot embedding its current form. All render from the same document-state schema and data and update through the same revisioned state.",
			[
				"- HTML templates use Mustache for display and `data-maket-bind` for native editable controls.",
				"- Supported: escaped values, positive and inverted sections, loops/current context, and comments.",
				"- Root references use `state.*`; relative names are allowed inside positive state sections.",
				"- Examples: `{{ state.title }}`, `{{#state.items}}...{{ label }} / {{ . }}...{{/state.items}}`, and `{{^state.items}}...{{/state.items}}`.",
				"- Invalid: triple braces, partials, lambdas, unscoped root names, sections inside a tag, Mustache in `<style>` or `<script>`, and values in any attribute outside the presentation whitelist (read the `html` topic, section Drawing from document state).",
			].join("\n"),
		),
		section(
			"JSON Forms",
			"Use JSON Forms when the form definition should be declarative rather than authored as HTML. Maket renders it with native controls; no React renderer is required.",
			"```text\nmaket_page action=set_form doc=<doc> page=<n> json_forms=<json>\n```",
			"Use <!--maket-json-form--> in a static HTML block container to embed the current form. set_form replaces the form while preserving that HTML template and its state-backed history. The slot must occur exactly once, outside Mustache sections. `uischema` is optional; without it, Maket generates a vertical form from the document-state JSON Schema. String choices come from `enum` or `oneOf`. State changes re-render the form.",
		),
		section(
			"JSON Forms styling",
			"The UI schema controls structure, labels, visibility, groups, horizontal or vertical layout, multiline fields, and radio presentation. Visual styling belongs to the Maket renderer, not to the JSON Forms data.",
			"Attach a charte to the document. The renderer uses `color.text` or `color.ink`, `color.bg` or `color.paper`, `color.surface`, `color.line` or `color.border`, `color.primary` or `color.accent`, `color.muted`, and `font.body` or `font.heading`, with neutral fallbacks.",
			"The same rendered style is used in the canvas, viewer, thumbnails, print, and PDF.",
		),
		section(
			"Complete minimal example",
			'```html\n<h1 data-id="title">{{ state.title }}</h1>\n<label data-id="done-label"><input data-id="done-input" type="checkbox" data-maket-bind="state.done"> Done</label>\n<input data-id="owner-input" type="text" data-maket-bind="state.owner">\n<select data-id="status-select" data-maket-bind="state.status"><option value="todo">To do</option><option value="done">Done</option></select>\n<button data-id="owner-editor" type="button" data-maket-bind="state.owner">Edit owner</button>\n```',
			'```json\n{"schema":{"type":"object","properties":{"title":{"type":"string"},"done":{"type":"boolean"},"owner":{"type":"string"},"status":{"type":"string","enum":["todo","done"]}},"required":["title","done","owner","status"]},"data":{"title":"Opening","done":false,"owner":"Camille","status":"todo"}}\n```',
			"```text\nmaket_state action=init doc=<doc> schema=<schema> data=<data>\n```",
			"`init` creates revision 1 and does not use `expected_revision`.",
		),
		section(
			"Hand-authored HTML controls",
			[
				"- Mustache interpolation is display-only.",
				"- Checkbox binds a boolean; text input binds a string and commits on blur or Enter. Escape cancels.",
				'- `<textarea data-maket-bind="state.note"></textarea>` binds a multiline string: the state value replaces whatever the template writes between the tags, Enter adds a line, the field commits on blur or ⌘/Ctrl+Enter, and Escape cancels. In the live canvas and the Reader its height follows its content between its own CSS `min-height` (or `rows`) and `max-height`, beyond which it scrolls; print and PDF show it at its CSS height.',
				"- A static select binds one string enum with exactly one option per value: no multiple, duplicates, or disabled optgroup coverage. For options from a state list, use the separate contract below.",
				'- A select can take its options from a state list instead: `<select data-maket-bind="state.agent" data-maket-options="state.agents"></select>`. The list holds strings or `{ "value": "…", "label": "…" }` objects and must be declared as an array by the schema; the bound value is a plain string (no enum needed), the options are generated at every render and replace any written between the tags, and a current value missing from the list keeps its own selected option. The server checks the value against the schema only, not against the list.',
				"- `button[type=button]` opens the single-terminal-value editor.",
				'- An action button writes a declared value instead: `<button type="button" data-maket-action="set" data-maket-bind="state.instruction" data-maket-value="Restart agent">Restart</button>`. A click writes `data-maket-value` to the bound path at the state revision the page shows, without an editor; several buttons bound to the field of a textarea pre-fill it. The value is typed as the binding: text for a string, a number, `true`/`false`, or `null`, and must belong to a string enum when there is one; a value that does not fit refuses the template. `data-maket-action` is optional and only `set` is accepted there.',
				"- `data-id` identifies authored structure; it is not a binding.",
				"- Never author or persist `data-maket-path`, `data-maket-type`, `pending`, or `error`.",
				"- The document owns all labels, accessibility, CSS, and native-state styling.",
			].join("\n"),
		),
		section(
			"Render slots: diagrams from state",
			[
				'- An empty element with `data-maket-render="mermaid"` and `data-maket-from="<state path>"` is a render slot: Maket draws the Mermaid source held at that path as inline SVG inside it, with the document\'s charte, in the live view, thumbnails, print, PDF and the portable reader.',
				'- The path is absolute (`state.flow`) or relative inside a section; a relative path reads the current list element only, so each element draws its own diagram and an element without the field draws nothing. The schema declares it `{"type":"string","format":"maket-mermaid"}`; a slot on any other path refuses the template. The element stays empty in the template, carries no `data-maket-bind`, and cannot sit inside `textarea`, `title`, `noscript`, `noembed`, `noframes`, `xmp`, `plaintext`, `iframe`, `script` or `style`.',
				"- `init`, `update`, `patch`, `change_schema`, `restore`, `add_item` and `update_item` refuse a source Mermaid cannot draw or one with `classDef`, `class`, `style`, `linkStyle` or `%%{init}`, naming the path and the Mermaid error, and write nothing. An empty string draws nothing.",
				"- When a charte is updated, the live view receives the redrawn diagrams at once and every later PDF or print uses the new charte; nothing to refresh. A JSON Forms control edits a `maket-mermaid` string in a textarea.",
				"- Limits: the compact cards of a Workspace collection index do not draw slots (a slot there stays empty); a thumbnail already cached keeps its old colours after a charte change until a change of its document invalidates it.",
			].join("\n"),
			'```html\n{{#state.steps}}<h2>{{ name }}</h2><figure data-maket-render="mermaid" data-maket-from="flow"></figure>{{/state.steps}}\n```',
			'```json\n{"schema":{"type":"object","properties":{"steps":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"flow":{"type":"string","format":"maket-mermaid"}}}}}},"data":{"steps":[{"name":"Release","flow":"flowchart LR\\n  Draft --> Review --> Signed"}]}}\n```',
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
				"7. History is unbounded by default. `maket_state action=set_retention doc=<doc> retention=<n>` keeps the current state plus the n previous revisions and prunes older ones on every write; `retention=0` keeps only the current state and `retention=null` restores the full history. Use it for continuously fed documents. A Workspace collection projection replaces a changed item entry in place, its revision number advancing without a new snapshot, so its history does not grow with item updates.",
			].join("\n"),
			"Failed template, schema, or data validation is atomic.",
		),
		section(
			"Lists longer than the page",
			[
				"- A section over an array placed in element content, not inside another list item and not inside `svg`, `select`, `textarea` or `title`, is a flowing list.",
				"- AUTO canvases retain all list items on one continuous content-height page. On fixed-height canvases, Maket lays the rendered page out at the canvas size. When an item of a flowing list ends below the canvas or below a clipping ancestor (`overflow` other than visible, line clamps excepted), that item and the following ones continue on a generated page `<page id>~2` named `<page name> (2)`, and so on. An item taller than the whole page stands alone on its own page, clipped, and the list continues after it.",
				"- The whole template repeats on every continuation page, so its own heading heads each of them; lists already shown render no item there, and inverted sections still test the whole array. The first element of every page of a flowed set carries `data-maket-flow-page` and `data-maket-flow-pages` (1-based) for a continuation style.",
				"- `#page=<n>` links keep pointing at the first page of their authored page. `maket_html check` measures every generated page; `set` and `patch` keep editing the authored template.",
			].join("\n"),
		),
		section(
			"Rendering and portability",
			"Live mode shows hydrated interactive controls. Model/Template mode shows persistent source and is non-interactive. Static output, print, and PDF show the same current values passively, including checked, value, and selected serialization, without mutation behavior.",
			"Portable .maket bundles carry the current schema and data snapshot, like collections carry their current members. Prior state revisions stay local; import initializes the snapshot as revision 1 and keeps the document's revision retention.",
		),
		section(
			"Next",
			"Read `html` for hand-authored structure and `review` before export.",
		),
	),
	"structured-workspaces": document(
		'A Workspace is the aggregate root for its schemas, templates, collection projections, items, instantiated documents, state history, and annotations. Build one with the method below: follow its steps in order, read every answer, and do not tell the user the Workspace works before `check` answers `"verdict": "ready"`.',
		section(
			"Method",
			"Three paths, in this order of preference. Every path ends with add_item and check. Each step gives the exact JSON call, every parameter with its type, what the answer contains verbatim, and what to verify before the next step.",
			"Generated templates: the detail template shows one labelled line per property in schema order with `{{ state.<property> }}` placeholders, titled by the first string property; its second page is a form on every editable property; the card shows the title and the next two properties; the index is a narrow page of content height (AUTO, 96 mm wide) that lists the cards in one column. A property is editable when its type is string, number, integer, boolean or a string enum and it is not marked `readOnly: true` (the JSON Schema keyword the form already honours): mark a property `readOnly: true` to keep it out of the form.",
			[
				"Parameters of `create` (and of `update_definition`, which adds `expected_workspace_revision` (integer)):",
				"- `workspace` (string): the Workspace name.",
				"- `data_schema` (object): JSON Schema of one item.",
				'- `representation_schema` (object, optional; omit it on path 1): `version` (integer 1, optional) and `collections` (object keyed by collection id). Each collection: `name` (string), `indexTemplateHtml`, `detailTemplateHtml`, `compactTemplateHtml` (string, inline HTML with `{{ state.<property> }}` placeholders), `detailForm` (object `{uischema}` in JSON Forms, Controls with `scope` `#/properties/<property>`), `collectionTemplateDocumentId` (string, exact name of an existing document, path 3), `groupBy`, `sortBy` (string JSON Pointer such as `/status`), `sortDirection` (`ascending` or `descending`), `groupOrder` (array), `pageSize` (integer), `indexPageSize` (integer, items per index batch, default 50, at most 500), `searchFields` (array of JSON Pointers searched by the index text query; default every string property of the binding schema at depth one), `bindings` (object keyed by binding id; omitted, one binding `item` covers the whole schema). Each binding: `schemaPath` (string, `""` for the whole schema), `detailTemplateDocumentId`, `compactTemplateDocumentId` (string names, path 3), and the same inline fields as the collection.',
				"- `allow_incomplete` (boolean, optional): persist a definition with errors instead of refusing it; reserved for deliberate drafts.",
			].join("\n"),
		),
		...methodSections(),
		section(
			"Where things live",
			[
				"- A Workspace owns its template documents, its index documents (one per collection, named `<workspace> — <collection>`) and its item documents. All of them live under the category `Structured Workspaces/<workspace name>`, never in the Documents library.",
				"- On paths 1 and 2 Maket creates and names the templates (`<workspace> — <collection> — index template`, `… — detail template`, `… — card template`); the agent never places or names a template document.",
				"- On path 3, a template document created in the library must be bound by `create` or `update_definition` in the same session: binding moves it into the Workspace category. An unbound template left in the library is an error of method.",
				"- Template references may be exact document names or stable ids; Maket stores ids. A template belongs to exactly one Workspace.",
				"- `list` prefixes each Workspace with `[ready]` or `[incomplete]`; `view` returns JSON whose first keys are `verdict`, `findings` (their count) and `check` (the call that lists them); `check` returns `{workspace, verdict, findings[]}`, each finding with `severity` (error, warning, hint), `object` (schema, collection, template, item, form, index), `collection`, `path`, `message`, `fix` and `next`. check never writes.",
				"- Incomplete Workspaces (only through `allow_incomplete=true`) stay visible, but their index and item documents cannot open until check is ready.",
			].join("\n"),
		),
		section(
			"Reading items by cursor",
			[
				"- The items live in the Workspace's item source, never in the index document. `view` answers the definition, `itemCounts` per collection, `pinnedItems`, the owned documents, and `window`: one batch of item summaries of one collection (`collection`, default the first) with `items[]` (`id`, `documentName`, `revision`, `fields`, `issues`), `next`, `total` and `groups` (count per group value over the whole query).",
				'- A query is `text` (searched in `searchFields`, ignoring case), `filters` (`[{"field":"/status","op":"eq","value":"todo"}]`, `op` `in` with a list of values), `sort` (`{"field":"/title","direction":"descending"}`; the collection `sortBy` otherwise) and `batch` (the collection `indexPageSize` otherwise, at most 500). Any of them starts a new query from the first item.',
				"- `next` is an opaque cursor: pass it back unchanged as `cursor=<next>` with the same workspace, collection and query arguments (the answer gives that call in `more`) to read the following batch, straight from the source; it is absent once the listing is exhausted. Paging by cursor is complete and without duplicates whatever the index or other clients do between two calls. There is no page number and no previous batch; to go back, start the query again.",
				"- A query without cursor also becomes the window every client sees: the index document renders the batches read so far, its group headers count the whole query. `view` with neither query nor cursor answers the first batch of the collection's own order.",
				"```text\nmaket_structured_workspace action=view workspace=<id-or-name> collection=<collection> text=<words> filters=<json> sort=<json> batch=<n>\nmaket_structured_workspace action=view workspace=<id-or-name> collection=<collection> cursor=<next>\n```",
			].join("\n"),
		),
		failureSection(),
		section(
			"Two contracts",
			[
				"- The data schema is a JSON Schema for every item and may use `oneOf`.",
				"- The representation schema gives each collection a global template and binds each concrete schema path to compact and detail template documents.",
				"- A collection may group its cards: `groupBy` is a JSON Pointer into the item data (for example `/status`), `groupOrder` lists the group values to place first (other groups follow in order of first appearance), and `pageSize` (default 24, at most 500) caps the compact cards per fixed-height collection page. AUTO collection pages retain all compact cards on one continuous page.",
				'- A collection may sort its cards: `sortBy` is a JSON Pointer into the item data (for example `/place`) and `sortDirection` is `"ascending"` (default) or `"descending"`; cards follow that value inside each group (or across the slot without `groupBy`), items without a value last and ties in insertion order, re-sorted when an item or the definition changes; without `sortBy`, insertion order stays.',
				"- A binding points to the concrete schema used by its instantiated document, so templates do not resolve `oneOf` themselves.",
				'- A compact template renders its `[data-maket-compact-root]` element as the card and keeps the `<style>` elements of its page: they are emitted once per collection page, every selector prefixed with the card\'s `[data-maket-compact-template="<key>"]` wrapper (`body`, `html`, `:root` and `:scope` stand for the card itself), so card CSS belongs in the compact template and cannot style the rest of the page. Card `data-id` values are prefixed per item, so style cards by class or element, not by `data-id`.',
			].join("\n"),
		),
		section(
			"Grouped, flowing collection pages",
			[
				"- On fixed-height canvases, without `groupBy`, each collection template page holds every card of its item slots; the cards that do not fit the laid-out page continue on further pages of the collection document (`<page id>~2`, `~3`, …), the template repeating on each.",
				'- With `groupBy`, every `data-maket-structured-items` slot receives, group by group, a `<header data-maket-structured-group="<value>">` with `[data-maket-structured-group-label]` and `[data-maket-structured-group-count]` children, followed by that group\'s compact cards.',
				"- On fixed-height canvases, when a slot exceeds `pageSize` cards, or when its cards do not fit the laid-out page, the template page repeats on further pages of the collection document (`<page id>~2`, `~3`, …); a group continued from the previous page repeats its header with `data-maket-structured-group-continued`. Static template content repeats on every flowed page.",
				"- Headers carry `grid-column: 1 / -1` and `flex: 0 0 100%`, so they span a grid or wrapping flex slot. Choose `pageSize` so that many cards plus their headers fit the page, then check a snapshot.",
				"- Item changes re-render the collection document and its page count.",
			].join("\n"),
			'```json\n{"name":"Projects","collectionTemplateDocumentId":"<board>","groupBy":"/status","groupOrder":["live","paused","dormant"],"pageSize":24,"bindings":{"project":{"schemaPath":"","compactTemplateDocumentId":"<card>","detailTemplateDocumentId":"<detail>"}}}\n```',
		),
		section(
			"Continuous indexes and Reader navigation",
			"Use one AUTO collection template page with a narrow fixed width for a continuous list. AUTO bypasses both pageSize splitting and physical-page flow; keep the content in normal flow and do not impose fixed height or clipping. A detail document may still have multiple real pages. The List and detail view opens two Reader panes, initially 28/72, with ordinary scrolling. Its icon-only layout toggle lives in the general toolbar: Square means one document and PanelLeft means list/detail; no separate view-choice toolbar is shown. Annotation remains an icon-only tool in the detail document toolbar. Opening another item replaces the detail and preserves the list. Canvas navigation is an explicit per-pane opt-in. A narrow window shows the library as an overlay rather than reducing document readability.",
		),
		section(
			"Clickable SVG cards",
			'HTML and SVG cards use the same native document action: data-maket-action="open-document" plus data-maket-document="<exact instantiated document name>". Enter and Space activate focusable cards. An SVG items slot must use SVG compact roots; its wrappers are SVG <g> elements. An HTML slot accepts an HTML compact root or a complete <svg> root, never a bare <g>. SVG slots cannot use automatic groupBy: author explicit SVG groups instead. Incompatible roots or grouping make Workspace integrity incomplete; fix the definition/templates before opening projections. Use explicit SVG positions for SVG cards.',
		),
		section(
			"Instantiated documents",
			[
				"- `add_item` validates the item and writes it to the Workspace's item source at revision 1; its state-backed document is created from the detail template when the item is opened or exported.",
				"- Template-controlled pages update through `sync_template` and cannot be edited directly.",
				"- Pages added to the instance remain editable and are preserved during template synchronization.",
				'- An item may hold a diagram: declare its property `{"type":"string","format":"maket-mermaid"}` and place a render slot `<div data-maket-render="mermaid" data-maket-from="state.<property>"></div>` in the detail template (read `state`, section Render slots).',
			].join("\n"),
		),
		section(
			"Other calls",
			"```text\nmaket_structured_workspace action=update_definition workspace=<id-or-name> expected_workspace_revision=<n> [data_schema=<schema>] [representation_schema=<schema>] [allow_incomplete=true]\nmaket_structured_workspace action=update_item workspace=<id-or-name> item=<id> expected_revision=<n> data=<data>\nmaket_structured_workspace action=delete_item workspace=<id-or-name> item=<id>\nmaket_structured_workspace action=sync_template workspace=<id-or-name> [collection=<collection>] [binding=<binding>]\nmaket_structured_workspace action=rename workspace=<id-or-name> new_name=<name> expected_workspace_revision=<n>\nmaket_structured_workspace action=delete workspace=<id-or-name>\n```",
			"update_definition validates existing item data, concrete bindings and prospective template pages before the definition changes; an erroneous definition is refused and the previous one kept. A collection or binding given without template references or inline HTML keeps its current templates. update_item refuses data that breaks the schema with the same path, rule and fix lines as add_item.",
			"Rename preserves every owned document id, state revision, annotation, and instance-owned page. Delete is an aggregate cascade; global images, chartes, and connections are not owned and remain intact.",
		),
		section(
			"Next",
			"Read `state` for the HTML binding contract and optimistic revision semantics.",
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
			"Human annotations",
			"The connected writable Reader and the detail document toolbar expose an explicit Annotate toggle. Annotation selects a target without editing HTML or state. Static and linked read-only readers cannot annotate. Read the current document's queue with `maket_workspace action=list_messages doc=<exact-name>`; omit doc only when an all-document review is intended. Each saved note includes id, type=note, docName, zero-based pageIndex, elementId (absent when the note is anchored to the whole page), text and ts; a note the person changed after sending also carries edited=true and editedAt, and its text is the current wording. Acknowledged notes cannot be edited. Read the target with maket_html get before interpreting the note. Keep the human wording intact, apply only authorized corrections, then acknowledge handled ids with maket_workspace action=ack_messages. A note is feedback, not an adopted decision.",
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
		section(
			"Linux desktop",
			"The Electron app bundles its runtime; install the Linux x64 DEB or RPM rather than the npm server when a native window is wanted. For an unpublished main version, select its desktop-snapshot workflow artifact at the exact commit. Follow docs/linux-desktop.md for package-manager commands, locating the installed executable, AppArmor/user-namespace diagnostics, and a testing-only --no-sandbox fallback. Do not disable system sandbox policies or run the app as root to fix a launch error. A version bump and push do not publish npm or create a release tag.",
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
		section(
			"Structured Workspaces",
			"Build a Structured Workspace with the method of `maket_learn action=topic topic=structured-workspaces`. Its first path, from a data schema alone:",
			STRUCTURED_WORKSPACE_FIRST_PATH,
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
		section(
			"Links between pages",
			"A link written `#page=3` or `#page:Page name` opens that page of the same document in the Reader and the viewer, and stays a clickable internal link in the PDF. In the canvas a click selects the link for editing; ⌘-click (Ctrl-click on Windows and Linux) follows it.",
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
	"structured-workspaces": document(
		"A Workspace is a typed list: you describe the fields of one item, and every item becomes a real document with its own page, gathered on an index page. Your assistant builds it in three steps and tells you it works only once Maket's check says ready.",
		section(
			"How a Workspace is built",
			[
				"1. The assistant describes the fields of one item (for example title, author, year, status). From that alone, Maket writes the index page, the detail page of an item, its card on the index, and a form to edit the item.",
				"2. The assistant adds the first item. Maket checks its values against the fields and creates its document.",
				"3. The assistant runs Maket's check, which answers ready or lists, for each problem, what is wrong and how to correct it.",
				"When you want a particular look, the assistant gives the page designs in the same first step instead, and Maket files them for you. Only when you already have template documents does it name them; it then attaches them right away.",
			].join("\n"),
		),
		section(
			"Where things live",
			"A Workspace keeps its templates, its index pages and its item documents together under its own name, in the Workspace tree. They never appear in the Documents library, except template documents prepared beforehand by name: those sit in the Documents library until the assistant attaches them to the Workspace, which moves them under its name. Template pages stay synchronized for every item, while pages added to one item document remain specific to it. Renaming a Workspace does not recreate those documents; deleting it removes them all.",
		),
		section(
			"When it fails",
			"Maket refuses a Workspace whose description has a mistake — a template that does not exist, a field shown on a page but not described, a form field that points nowhere, grouping by an unknown field — and says for each one what to change. It refuses an item whose values do not fit the fields. Its check also reports pages that no longer match their template and an empty Workspace. Nothing half-built is kept unless the assistant asks for it explicitly.",
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
		section(
			"Structured Workspaces",
			"Ask Gemini to follow the Structured Workspaces method of Maket's learning topics: describe the fields of one item, add the first item, then run Maket's check until it says ready.",
		),
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
