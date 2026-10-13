import type {
	StructuredWorkspaceDataSchema,
	StructuredWorkspaceDefinition,
	StructuredWorkspaceFinding,
} from "@maket/shared";
import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import {
	isStructuredWorkspaceRefusal,
	type StructuredWorkspaceRepresentationInput,
	type StructuredWorkspaces,
} from "../services/structured-workspaces.js";
import { json, text } from "./_helpers.js";

export interface StructuredWorkspacesToolDeps {
	structuredWorkspaces: StructuredWorkspaces;
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
});

const DESCRIPTION = [
	"When to use: create and operate a Structured Workspace — a schema-driven collection whose items own real instantiated Maket documents.",
	"",
	"Method (full recipe: maket_learn action=topic topic=structured-workspaces): 1) create with a data_schema alone — Maket writes the index, detail, card templates and the detail form itself, in the Workspace category; 2) add_item; 3) check, which must answer verdict ready. Inline template HTML (detailTemplateHtml, compactTemplateHtml, indexTemplateHtml, detailForm) or names of existing template documents are the optional second and third paths.",
	"create and update_definition refuse a definition with errors (isError, one line per error with collection, path and fix) and keep the previous definition; allow_incomplete=true persists it anyway. add_item and update_item refuse data that breaks the schema with its path, rule and fix.",
	"",
	"The data schema validates every item. The representation schema declares one or more collections; each collection owns its global template and binds concrete schema paths to compact and detail templates. Adding an item instantiates the detail template as a persistent state-backed document. Template-controlled pages are synchronized from the template; instance-owned pages remain in the same document.",
	'Optional collection grouping: `groupBy` is a JSON Pointer into item data (e.g. "/status"), `groupOrder` lists group values to place first, and `pageSize` (default 24) caps the compact cards per collection page. With `groupBy`, each item slot receives a group header followed by its cards and the collection document flows onto as many pages as needed; without it, the collection stays one page.',
	'Optional collection sort: `sortBy` is a JSON Pointer into item data (e.g. "/place") and `sortDirection` is "ascending" (default) or "descending"; cards are ordered by that value inside each group, or across the slot without `groupBy`, items without a value last and ties in insertion order; without `sortBy`, insertion order stays.',
	"  list          — list Structured Workspaces, each prefixed with ready or incomplete.",
	"  view          — verdict and finding count first, then schemas, items, current data revisions, and instantiated documents.",
	"  check         — the doctor: verdict ready or not ready and every finding with severity, object, sentence, fix and next call. Never writes.",
	"  create        — create a workspace from a data schema, with an optional representation schema; refuses errors unless allow_incomplete=true.",
	"  update_definition — validate and replace the data and/or representation contract, then update instantiated documents; an erroneous definition is refused and the previous one kept unless allow_incomplete=true.",
	"  add_item      — validate data and instantiate its persistent document.",
	"  update_item   — replace item data with optimistic revision control.",
	"  delete_item   — delete the item and its instantiated document.",
	"  sync_template — propagate current detail-template pages while preserving instance-owned pages.",
	"  rename        — rename the Workspace without regenerating owned documents.",
	"  delete        — atomically delete the Workspace and every document, state revision, and annotation it owns.",
].join("\n");

const LEARN_CALL = "maket_learn action=topic topic=structured-workspaces";

type Args = z.infer<typeof StructuredWorkspaceSchema>;

export function createMaketStructuredWorkspaceTool({
	structuredWorkspaces,
}: StructuredWorkspacesToolDeps): ToolHandler {
	return {
		metadata: {
			name: "maket_structured_workspace",
			description: DESCRIPTION,
			schema: StructuredWorkspaceSchema,
		},
		handler: async (rawArgs) =>
			handleStructuredWorkspaceTool(rawArgs, structuredWorkspaces),
	};
}

function handleStructuredWorkspaceTool(
	rawArgs: unknown,
	structuredWorkspaces: StructuredWorkspaces,
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
		return dispatch(parsed.data, structuredWorkspaces);
	} catch (error) {
		if (isStructuredWorkspaceRefusal(error)) {
			return text(
				[error.message, ...error.findings.map(findingLine)].join("\n"),
				{ isError: true, next: refusalNext(parsed.data, error.findings) },
			);
		}
		const message = error instanceof Error ? error.message : String(error);
		if (
			message.startsWith("Item data breaks the schema") &&
			parsed.data.workspace
		)
			return text(message, {
				isError: true,
				next: [
					`maket_structured_workspace action=view workspace=${parsed.data.workspace}`,
				],
			});
		return text(message, true);
	}
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
			`maket_structured_workspace action=create workspace=${args.workspace ?? "<name>"} data_schema=<schema>  (no representation_schema: Maket generates every template)`,
		);
	calls.push(LEARN_CALL);
	return calls;
}

function dispatch(args: Args, workspaces: StructuredWorkspaces) {
	if (args.action === "list") return runList(workspaces);
	if (args.action === "view") return runView(args, workspaces);
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

function runUpdateDefinition(args: Args, workspaces: StructuredWorkspaces) {
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
				return `- [${verdict === "ready" ? "ready" : "incomplete"}] ${workspace.name} (${workspace.id}): ${workspace.items.length} item(s), revision ${workspace.revision}`;
			})
			.join("\n"),
	);
}

function runView(args: Args, workspaces: StructuredWorkspaces) {
	const name = required(args.workspace, "workspace");
	const workspace = workspaces.get(name);
	if (!workspace)
		return text(`Structured Workspace "${name}" not found.`, true);
	const check = workspaces.check(workspace.id);
	const call = `maket_structured_workspace action=check workspace=${workspace.id}`;
	const value = {
		verdict: check.verdict,
		findings: check.findings.length,
		check: call,
		...workspace,
	};
	return json(value, { indent: 2 });
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

function runAddItem(args: Args, workspaces: StructuredWorkspaces) {
	const item = workspaces.addItem({
		workspace: required(args.workspace, "workspace"),
		itemId: args.item,
		collectionId: required(args.collection, "collection"),
		bindingId: required(args.binding, "binding"),
		documentName: required(args.document_name, "document_name"),
		data: requiredValue(args.data, "data"),
	});
	return text(
		`Item "${item.id}" instantiated as document "${item.documentName}" at data revision ${item.dataRevision}.`,
		{
			next: [
				`maket_structured_workspace action=check workspace=${args.workspace}`,
			],
		},
	);
}

function runUpdateItem(args: Args, workspaces: StructuredWorkspaces) {
	const workspace = required(args.workspace, "workspace");
	const item = required(args.item, "item");
	const updated = workspaces.updateItem(
		workspace,
		item,
		requiredValue(args.expected_revision, "expected_revision"),
		requiredValue(args.data, "data"),
	);
	return text(
		`Item "${updated.id}" updated to data revision ${updated.dataRevision}.`,
	);
}

function runDeleteItem(args: Args, workspaces: StructuredWorkspaces) {
	const workspace = required(args.workspace, "workspace");
	const item = required(args.item, "item");
	workspaces.deleteItem(workspace, item);
	return text(`Item "${item}" and its instantiated document were deleted.`);
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
	requires: ["structuredWorkspaces"],
	declaresTools: ["maket_structured_workspace"],
	register(container) {
		container.register({
			maketStructuredWorkspaceTool: asFunction(
				createMaketStructuredWorkspaceTool,
			).singleton(),
		});
	},
};
