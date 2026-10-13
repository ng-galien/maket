import {
	type StructuredCollectionQuery,
	type StructuredCollectionWindowItem,
	type StructuredWorkspaceDataSchema,
	type StructuredWorkspaceDefinition,
	type StructuredWorkspaceFinding,
	type StructuredWorkspaceView,
	structuredWorkspaceMaxBatch,
} from "@maket/shared";
import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import {
	isItemSourceError,
	itemSourceError,
} from "../services/item-sources/item-source-error.js";
import type { ItemWindows } from "../services/item-windows.js";
import {
	isStructuredWorkspaceRefusal,
	type StructuredWorkspaceRepresentationInput,
	type StructuredWorkspaces,
} from "../services/structured-workspaces.js";
import { json, text } from "./_helpers.js";

export interface StructuredWorkspacesToolDeps {
	structuredWorkspaces: StructuredWorkspaces;
	itemWindows: Pick<ItemWindows, "query" | "page">;
}

const FormSchema = z.object({
	uischema: z.record(z.string(), z.unknown()).optional(),
});

const InlineTemplates = {
	detailTemplateHtml: z.string().optional(),
	compactTemplateHtml: z.string().optional(),
	detailForm: FormSchema.optional(),
};

const BindingSchema = z.object({
	schemaPath: z.string().optional(),
	compactTemplateDocumentId: z.string().optional(),
	detailTemplateDocumentId: z.string().optional(),
	...InlineTemplates,
});

const CollectionRepresentationSchema = z.object({
	name: z.string().optional(),
	identity: z.string().optional(),
	collectionTemplateDocumentId: z.string().optional(),
	indexTemplateHtml: z.string().optional(),
	...InlineTemplates,
	bindings: z.record(z.string(), BindingSchema).optional(),
	groupBy: z.string().optional(),
	groupOrder: z
		.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
		.optional(),
	pageSize: z.number().int().positive().optional(),
	sortBy: z.string().optional(),
	sortDirection: z.enum(["ascending", "descending"]).optional(),
	indexPageSize: z.number().int().positive().optional(),
	searchFields: z.array(z.string()).optional(),
});

const GroupValueSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.null(),
]);

const FilterSchema = z.object({
	field: z.string(),
	op: z.enum(["eq", "in"]),
	value: z.union([GroupValueSchema, z.array(GroupValueSchema)]),
});

const RepresentationSchema = z.object({
	version: z.literal(1).optional(),
	collections: z.record(z.string(), CollectionRepresentationSchema).optional(),
});

const StructuredWorkspaceSchema = z.object({
	action: z.enum([
		"list",
		"view",
		"check",
		"create",
		"update_definition",
		"add_item",
		"update_item",
		"delete_item",
		"sync_template",
		"rename",
		"delete",
	]),
	workspace: z.string().optional(),
	new_name: z.string().optional(),
	description: z.string().optional(),
	data_schema: z.record(z.string(), z.unknown()).optional(),
	representation_schema: RepresentationSchema.optional(),
	item: z.string().optional(),
	collection: z.string().optional(),
	binding: z.string().optional(),
	document_name: z.string().optional(),
	data: z.record(z.string(), z.unknown()).optional(),
	expected_revision: z.number().int().positive().optional(),
	expected_workspace_revision: z.number().int().positive().optional(),
	allow_incomplete: z.boolean().optional(),
	text: z.string().optional(),
	filters: z.array(FilterSchema).optional(),
	sort: z
		.object({
			field: z.string(),
			direction: z.enum(["ascending", "descending"]).optional(),
		})
		.optional(),
	cursor: z.string().optional(),
	batch: z.number().int().positive().optional(),
});

const DESCRIPTION = [
	"When to use: create and operate a Structured Workspace — a schema-driven collection of items, listed in an index and opened as Maket documents built from templates.",
	"",
	'Method (full recipe: maket_learn action=topic topic=structured-workspaces): 1) create with a data_schema alone that has a required "id" property (string), one value per item: Maket identifies the items by "/id" — or declare another identity per collection, e.g. representation_schema={"collections":{"items":{"name":"Items","identity":"/code"}}} — and Maket writes the index, detail, card templates and the detail form itself, in the Workspace category; 2) add_item; 3) check, which must answer verdict ready. Inline template HTML (detailTemplateHtml, compactTemplateHtml, indexTemplateHtml, detailForm) or names of existing template documents are the optional second and third paths.',
	'Identity: every collection has an `identity`, a JSON Pointer to a required string or number property of its items (e.g. "/code"); without one, "/id" when the schema requires an id property. Its value, as a string, is the item id used everywhere (item=, documents, cursors) and is unique across the whole Workspace, all collections included; Maket never generates one. add_item refuses data without it, or a value another item of the Workspace already bears (invalid_record, naming that item); update_item refuses a change of it: delete and add the item again instead. The identity of a collection holding items cannot be changed.',
	"create and update_definition refuse a definition with errors (isError, one line per error with collection, path and fix) and keep the previous definition; allow_incomplete=true persists it anyway. add_item and update_item refuse data that breaks the schema with its path, rule and fix.",
	"",
	"The data schema validates every item. The representation schema declares one or more collections; each collection owns its global template and binds concrete schema paths to compact and detail templates. The item source holds the item data; an item's document is created from its detail template when the item is opened or exported. Template-controlled pages are synchronized from the template; instance-owned pages remain in the same document.",
	'Reading items is a cursor query: view answers one batch of item summaries for one collection (collection, default the first) with `next` (an opaque cursor, absent once the listing is exhausted), `total` and the group counts. Pass text (searches `searchFields`, by default every text property, ignoring case and accents), filters ([{"field":"/status","op":"eq","value":"todo"}], op in for a list), sort ({"field":"/title","direction":"descending"}) and batch (default `indexPageSize`, 50; at most 500) to start a new query, which also becomes the window every client sees in the index. To read the next batch, pass cursor=<next> with the same query arguments (the answer gives the call in `more`): it reads the source directly and never depends on the shared window: no item that existed before and kept its sort value is skipped or read twice, while an item whose sort value changes during paging may move across the cursor. There is no page number and no previous: a new query restarts from the first item. view with neither query nor cursor answers the first batch of the collection\'s own order.',
	'Optional collection grouping: `groupBy` is a JSON Pointer into item data (e.g. "/status"), `groupOrder` lists group values to place first, and `pageSize` (default 24) caps the compact cards per collection page. With `groupBy`, each item slot receives a group header followed by its cards and the collection document flows onto as many pages as needed; without it, the collection stays one page.',
	'Optional collection sort: `sortBy` is a JSON Pointer into item data (e.g. "/place") and `sortDirection` is "ascending" (default) or "descending"; cards are ordered by that value inside each group, or across the slot without `groupBy`, items without a value last and ties in item id order; without `sortBy`, insertion order stays.',
	"  list          — list Structured Workspaces, each prefixed with ready or incomplete.",
	"  view          — verdict and finding count first, then the definition, item counts, pinned items, owned documents, and one batch of the collection window (see the cursor query above).",
	"  check         — the doctor: verdict ready or not ready and every finding with severity, object, sentence, fix and next call. Never writes.",
	"  create        — create a workspace from a data schema, with an optional representation schema; refuses errors unless allow_incomplete=true.",
	"  update_definition — validate and replace the data and/or representation contract, then update the item and index documents that exist; an erroneous definition is refused and the previous one kept unless allow_incomplete=true.",
	"  add_item      — validate data and write the item to its source under the id its identity property holds; its document is created when the item is opened.",
	"  update_item   — replace item data with optimistic revision control.",
	"  delete_item   — delete the item from its source, with its document when it was opened.",
	"  sync_template — propagate current detail-template pages while preserving instance-owned pages.",
	"  rename        — rename the Workspace without regenerating owned documents.",
	"  delete        — atomically delete the Workspace and every document, state revision, and annotation it owns.",
].join("\n");

const LEARN_CALL = "maket_learn action=topic topic=structured-workspaces";

type Args = z.infer<typeof StructuredWorkspaceSchema>;

export function createMaketStructuredWorkspaceTool({
	structuredWorkspaces,
	itemWindows,
}: StructuredWorkspacesToolDeps): ToolHandler {
	return {
		metadata: {
			name: "maket_structured_workspace",
			description: DESCRIPTION,
			schema: StructuredWorkspaceSchema,
		},
		handler: async (rawArgs) =>
			handleStructuredWorkspaceTool(rawArgs, {
				structuredWorkspaces,
				itemWindows,
			}),
	};
}

async function handleStructuredWorkspaceTool(
	rawArgs: unknown,
	deps: StructuredWorkspacesToolDeps,
) {
	const parsed = StructuredWorkspaceSchema.safeParse(rawArgs);
	if (!parsed.success) {
		return text(
			parsed.error.issues
				.map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`)
				.join("\n"),
			{ isError: true, next: [LEARN_CALL] },
		);
	}
	try {
		return await dispatch(parsed.data, deps);
	} catch (error) {
		return failureAnswer(error, parsed.data);
	}
}

/** Source refusals of a query, answered with their code. */
const queryRefusals: ReadonlySet<string> = new Set([
	"unknown_workspace",
	"unknown_collection",
	"query_unsupported",
	"invalid_record",
]);

/** The answer to a failed call: a refused definition with its findings, a
 * typed refusal of the item source, or the error text. */
function failureAnswer(error: unknown, args: Args) {
	if (isStructuredWorkspaceRefusal(error))
		return text(
			[error.message, ...error.findings.map(findingLine)].join("\n"),
			{
				isError: true,
				next: refusalNext(args, error.findings),
			},
		);
	if (isItemSourceError(error) && queryRefusals.has(error.code))
		return text(`${error.code}: ${error.message}`, {
			isError: true,
			next: [
				error.code === "unknown_workspace" || !args.workspace
					? "maket_structured_workspace action=list"
					: `maket_structured_workspace action=view workspace=${args.workspace}`,
			],
		});
	const message = error instanceof Error ? error.message : String(error);
	if (message.startsWith("Item data breaks the schema") && args.workspace)
		return text(message, {
			isError: true,
			next: [
				`maket_structured_workspace action=view workspace=${args.workspace}`,
			],
		});
	return text(message, true);
}

/** One line per finding: collection, path, sentence, fix. */
function findingLine(finding: StructuredWorkspaceFinding): string {
	const where = finding.collection
		? `collection "${finding.collection}" · ${finding.path}`
		: finding.path;
	return `- ${where}: ${finding.message} Fix: ${finding.fix}`;
}

function refusalNext(
	args: Args,
	findings: StructuredWorkspaceFinding[],
): string[] {
	const calls = [
		...new Set(
			findings.flatMap((finding) => (finding.next ? [finding.next] : [])),
		),
	];
	if (args.action === "create")
		calls.push(
			`maket_structured_workspace action=create workspace=${args.workspace ?? "<name>"} data_schema=<schema with a required "id" property of type string>  (Maket identifies the items by "/id" and generates every template)`,
		);
	calls.push(LEARN_CALL);
	return calls;
}

function dispatch(args: Args, deps: StructuredWorkspacesToolDeps) {
	const workspaces = deps.structuredWorkspaces;
	if (args.action === "list") return runList(workspaces);
	if (args.action === "view") return runView(args, deps);
	if (args.action === "check") return runCheck(args, workspaces);
	if (args.action === "create") return runCreate(args, workspaces);
	if (args.action === "update_definition")
		return runUpdateDefinition(args, workspaces);
	if (args.action === "add_item") return runAddItem(args, workspaces);
	if (args.action === "update_item") return runUpdateItem(args, workspaces);
	if (args.action === "delete_item") return runDeleteItem(args, workspaces);
	if (args.action === "rename") return runRename(args, workspaces);
	if (args.action === "delete") return runDelete(args, workspaces);
	return runSyncTemplate(args, workspaces);
}

function runCheck(args: Args, workspaces: StructuredWorkspaces) {
	return json(workspaces.check(required(args.workspace, "workspace")), {
		indent: 2,
	});
}

/** What the agent must read after a definition change: the verdict, the
 * template documents Maket owns, and the errors when incomplete. */
function definitionReport(
	headline: string,
	workspaces: StructuredWorkspaces,
	workspace: Pick<StructuredWorkspaceDefinition, "id" | "name">,
	defaulted: readonly string[] = [],
) {
	const view = workspaces.get(workspace.id);
	const check = workspaces.check(workspace.id);
	const errors = check.findings.filter(
		(finding) => finding.severity === "error",
	);
	const lines = [
		`${headline} ${check.verdict === "ready" ? "Verdict: ready." : `Verdict: incomplete, ${errors.length} error(s):`}`,
		...errors.map(findingLine),
	];
	if (view) {
		lines.push(
			`Collections: ${Object.entries(view.representationSchema.collections)
				.map(
					([id, collection]) =>
						`${id} (bindings: ${Object.keys(collection.bindings).join(", ")})`,
				)
				.join("; ")}.`,
			`Template documents in category "Structured Workspaces/${view.name}": ${view.templateDocuments.map((document) => `"${document.documentName}"`).join(", ")}.`,
			...defaulted.flatMap((collectionId) =>
				view.representationSchema.collections[collectionId]?.identity === "/id"
					? [
							`Identity: no identity was given for collection "${collectionId}"; its items are identified by "/id", the required id property of the data schema (unique across the whole Workspace, never changed).`,
						]
					: [],
			),
		);
	}
	const [collectionId, collection] =
		Object.entries(view?.representationSchema.collections ?? {})[0] ?? [];
	return text(lines.join("\n"), {
		next:
			check.verdict === "ready"
				? [
						`maket_structured_workspace action=add_item workspace=${workspace.id} collection=${collectionId ?? "<collection>"} binding=${Object.keys(collection?.bindings ?? {})[0] ?? "<binding>"} document_name=<name> data=<json>`,
						`maket_structured_workspace action=check workspace=${workspace.id}`,
					]
				: [
						`maket_structured_workspace action=check workspace=${workspace.id}`,
						LEARN_CALL,
					],
	});
}

/** The collections of a create or update_definition call that gave no
 * identity and had none before: they take the default identity, if any. */
function undeclaredIdentities(
	args: Args,
	before: StructuredWorkspaceView | null,
): string[] {
	const collections = args.representation_schema?.collections ?? {
		items: {},
	};
	return Object.entries(collections).flatMap(([collectionId, collection]) =>
		collection.identity === undefined &&
		!before?.representationSchema.collections[collectionId]?.identity
			? [collectionId]
			: [],
	);
}

function runUpdateDefinition(args: Args, workspaces: StructuredWorkspaces) {
	const before = workspaces.get(required(args.workspace, "workspace"));
	const workspace = workspaces.updateDefinition({
		workspace: required(args.workspace, "workspace"),
		expectedRevision: requiredValue(
			args.expected_workspace_revision,
			"expected_workspace_revision",
		),
		dataSchema: args.data_schema as StructuredWorkspaceDataSchema | undefined,
		representationSchema: args.representation_schema as
			| StructuredWorkspaceRepresentationInput
			| undefined,
		allowIncomplete: args.allow_incomplete,
	});
	return definitionReport(
		`Structured Workspace "${workspace.name}" updated to revision ${workspace.revision}.`,
		workspaces,
		workspace,
		args.representation_schema ? undeclaredIdentities(args, before) : [],
	);
}

function runList(workspaces: StructuredWorkspaces) {
	const list = workspaces.list();
	if (list.length === 0)
		return text("No Structured Workspaces.", {
			next: [
				"maket_structured_workspace action=create workspace=<name> data_schema=<schema>",
				LEARN_CALL,
			],
		});
	return text(
		list
			.map((workspace) => {
				const verdict = workspaces.check(workspace.id).verdict;
				const items = Object.values(workspace.itemCounts).reduce(
					(sum, count) => sum + count,
					0,
				);
				return `- [${verdict === "ready" ? "ready" : "incomplete"}] ${workspace.name} (${workspace.id}): ${items} item(s), revision ${workspace.revision}`;
			})
			.join("\n"),
	);
}

function runView(args: Args, deps: StructuredWorkspacesToolDeps) {
	const workspaces = deps.structuredWorkspaces;
	const name = required(args.workspace, "workspace");
	const workspace = workspaces.get(name);
	if (!workspace)
		throw itemSourceError(
			"unknown_workspace",
			`Structured Workspace "${name}" not found.`,
		);
	const check = workspaces.check(workspace.id);
	const call = `maket_structured_workspace action=check workspace=${workspace.id}`;
	const value = {
		verdict: check.verdict,
		findings: check.findings.length,
		check: call,
		...workspace,
		window: viewWindow(args, deps.itemWindows, workspace),
	};
	return json(value, { indent: 2 });
}

/** One batch of a collection, read from its source. With a cursor, the
 * batch after it, statelessly, whatever the shared window does; with query
 * arguments, the first batch of that query, which becomes the shared window;
 * with neither, the first batch of the collection's own order. */
function viewWindow(
	args: Args,
	itemWindows: StructuredWorkspacesToolDeps["itemWindows"],
	workspace: StructuredWorkspaceView,
) {
	const collectionId =
		args.collection ??
		Object.keys(workspace.representationSchema.collections)[0];
	if (!collectionId || workspace.integrity.status !== "ready") return null;
	if (!workspace.representationSchema.collections[collectionId])
		throw itemSourceError(
			"unknown_collection",
			`Collection "${collectionId}" not found in Structured Workspace "${workspace.name}".`,
		);
	const query = viewQuery(args);
	const page =
		args.cursor !== undefined || Object.keys(query).length === 0
			? itemWindows.page(workspace.id, collectionId, {
					...query,
					...(args.cursor === undefined ? {} : { cursor: args.cursor }),
				})
			: (() => {
					const { window } = itemWindows.query(
						workspace.id,
						collectionId,
						query,
					);
					return window;
				})();
	return {
		collection: collectionId,
		query,
		items: page.items.map(viewItem),
		...(page.next === undefined
			? {}
			: {
					next: page.next,
					more: moreCall(workspace.id, collectionId, args, page.next),
				}),
		...(page.total === undefined ? {} : { total: page.total }),
		...(page.groups === undefined ? {} : { groups: page.groups }),
	};
}

/** The query arguments of a view call, as the window and the source take them. */
function viewQuery(args: Args): StructuredCollectionQuery {
	return {
		...(args.text === undefined ? {} : { text: args.text }),
		...(args.filters === undefined ? {} : { filters: args.filters }),
		...(args.sort === undefined
			? {}
			: {
					sort: {
						field: args.sort.field,
						direction: args.sort.direction ?? "ascending",
					},
				}),
		...(args.batch === undefined
			? {}
			: { batch: Math.min(args.batch, structuredWorkspaceMaxBatch) }),
	};
}

/** The call reading the next batch: the same query arguments and the cursor. */
function moreCall(
	workspaceId: string,
	collectionId: string,
	args: Args,
	cursor: string,
): string {
	const json = (value: unknown) => `'${JSON.stringify(value)}'`;
	return [
		`maket_structured_workspace action=view workspace=${workspaceId} collection=${collectionId}`,
		...(args.text === undefined ? [] : [`text=${json(args.text)}`]),
		...(args.filters === undefined ? [] : [`filters=${json(args.filters)}`]),
		...(args.sort === undefined ? [] : [`sort=${json(args.sort)}`]),
		...(args.batch === undefined ? [] : [`batch=${args.batch}`]),
		`cursor=${cursor}`,
	].join(" ");
}

function viewItem(item: StructuredCollectionWindowItem) {
	return {
		id: item.id,
		documentName: item.documentName,
		revision: Number(item.revision),
		fields: item.fields,
		...(item.issues ? { issues: item.issues } : {}),
	};
}

function runCreate(args: Args, workspaces: StructuredWorkspaces) {
	const name = required(args.workspace, "workspace");
	const workspace = workspaces.create({
		name,
		description: args.description,
		dataSchema: (args.data_schema ?? {}) as StructuredWorkspaceDataSchema,
		representationSchema: args.representation_schema as
			| StructuredWorkspaceRepresentationInput
			| undefined,
		allowIncomplete: args.allow_incomplete,
	});
	return definitionReport(
		`Structured Workspace "${workspace.name}" created (id ${workspace.id}).`,
		workspaces,
		workspace,
		undeclaredIdentities(args, null),
	);
}

function runRename(args: Args, workspaces: StructuredWorkspaces) {
	const updated = workspaces.rename(
		required(args.workspace, "workspace"),
		required(args.new_name, "new_name"),
		requiredValue(
			args.expected_workspace_revision,
			"expected_workspace_revision",
		),
	);
	return text(
		`Workspace "${updated.name}" renamed without regenerating its documents.`,
	);
}

function runDelete(args: Args, workspaces: StructuredWorkspaces) {
	const workspace = required(args.workspace, "workspace");
	const deletedDocuments = workspaces.delete(workspace);
	return text(
		`Workspace "${workspace}" deleted with ${deletedDocuments.length} owned document(s).`,
	);
}

async function runAddItem(args: Args, workspaces: StructuredWorkspaces) {
	const item = await workspaces.addItem({
		workspace: required(args.workspace, "workspace"),
		itemId: args.item,
		collectionId: required(args.collection, "collection"),
		bindingId: required(args.binding, "binding"),
		documentName: required(args.document_name, "document_name"),
		data: requiredValue(args.data, "data"),
	});
	return text(
		`Item "${item.id}" added to collection "${item.collectionId}" at data revision ${item.dataRevision}; it opens as document "${item.documentName}".`,
		{
			next: [
				`maket_structured_workspace action=check workspace=${args.workspace}`,
			],
		},
	);
}

async function runUpdateItem(args: Args, workspaces: StructuredWorkspaces) {
	const workspace = required(args.workspace, "workspace");
	const item = required(args.item, "item");
	const updated = await workspaces.updateItem(
		workspace,
		item,
		requiredValue(args.expected_revision, "expected_revision"),
		requiredValue(args.data, "data"),
	);
	return text(
		`Item "${updated.id}" updated to data revision ${updated.dataRevision}.`,
	);
}

async function runDeleteItem(args: Args, workspaces: StructuredWorkspaces) {
	const workspace = required(args.workspace, "workspace");
	const item = required(args.item, "item");
	await workspaces.deleteItem(workspace, item);
	return text(`Item "${item}" was deleted from its source.`);
}

function runSyncTemplate(args: Args, workspaces: StructuredWorkspaces) {
	const workspace = required(args.workspace, "workspace");
	const updated = workspaces.syncTemplates(
		workspace,
		args.collection,
		args.binding,
	);
	return text(
		`Synchronized template-controlled pages in ${updated} instantiated document(s).`,
	);
}

function required(value: string | undefined, field: string): string {
	if (!value) throw new Error(`${field} is required`);
	return value;
}

function requiredValue<T>(value: T | undefined, field: string): T {
	if (value === undefined) throw new Error(`${field} is required`);
	return value;
}

export const structuredWorkspacesPack: ToolPack = {
	id: "structured-workspaces",
	name: "Structured Workspaces",
	requires: ["structuredWorkspaces", "itemWindows"],
	declaresTools: ["maket_structured_workspace"],
	register(container) {
		container.register({
			maketStructuredWorkspaceTool: asFunction(
				createMaketStructuredWorkspaceTool,
			).singleton(),
		});
	},
};
