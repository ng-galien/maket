import type {
	StructuredWorkspaceDataSchema,
	StructuredWorkspaceRepresentationSchema,
} from "@maket/shared";
import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import type { StructuredWorkspaces } from "../services/structured-workspaces.js";
import { text } from "./_helpers.js";

export interface StructuredWorkspacesToolDeps {
	structuredWorkspaces: StructuredWorkspaces;
}

const BindingSchema = z.object({
	schemaPath: z.string(),
	compactTemplateDocumentId: z.string().optional(),
	detailTemplateDocumentId: z.string(),
});

const CollectionRepresentationSchema = z.object({
	name: z.string(),
	collectionTemplateDocumentId: z.string(),
	bindings: z.record(z.string(), BindingSchema),
});

const RepresentationSchema = z.object({
	version: z.literal(1),
	collections: z.record(z.string(), CollectionRepresentationSchema),
});

const StructuredWorkspaceSchema = z.object({
	action: z.enum([
		"list",
		"view",
		"create",
		"update_definition",
		"add_item",
		"update_item",
		"delete_item",
		"sync_template",
	]),
	workspace: z.string().optional(),
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
});

const DESCRIPTION = [
	"When to use: create and operate a Structured Workspace — a schema-driven collection whose items own real instantiated Maket documents.",
	"",
	"The data schema validates every item. The representation schema declares one or more collections; each collection owns its global template and binds concrete schema paths to compact and detail templates. Adding an item instantiates the detail template as a persistent state-backed document. Template-controlled pages are synchronized from the template; instance-owned pages remain in the same document.",
	"  list          — list Structured Workspaces.",
	"  view          — read schemas, items, current data revisions, and instantiated documents.",
	"  create        — create a workspace from data and representation schemas.",
	"  update_definition — validate and replace the data and/or representation contract, then update instantiated documents.",
	"  add_item      — validate data and instantiate its persistent document.",
	"  update_item   — replace item data with optimistic revision control.",
	"  delete_item   — delete the item and its instantiated document.",
	"  sync_template — propagate current detail-template pages while preserving instance-owned pages.",
].join("\n");

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
			true,
		);
	}
	try {
		return dispatch(parsed.data, structuredWorkspaces);
	} catch (error) {
		return text(error instanceof Error ? error.message : String(error), true);
	}
}

function dispatch(args: Args, workspaces: StructuredWorkspaces) {
	if (args.action === "list") return runList(workspaces);
	if (args.action === "view") return runView(args, workspaces);
	if (args.action === "create") return runCreate(args, workspaces);
	if (args.action === "update_definition")
		return runUpdateDefinition(args, workspaces);
	if (args.action === "add_item") return runAddItem(args, workspaces);
	if (args.action === "update_item") return runUpdateItem(args, workspaces);
	if (args.action === "delete_item") return runDeleteItem(args, workspaces);
	return runSyncTemplate(args, workspaces);
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
			| StructuredWorkspaceRepresentationSchema
			| undefined,
	});
	return text(
		`Structured Workspace "${workspace.name}" updated to revision ${workspace.revision}.`,
	);
}

function runList(workspaces: StructuredWorkspaces) {
	const list = workspaces.list();
	if (list.length === 0) return text("No Structured Workspaces.");
	return text(
		list
			.map(
				(workspace) =>
					`- ${workspace.name}: ${workspace.items.length} item(s), revision ${workspace.revision}`,
			)
			.join("\n"),
	);
}

function runView(args: Args, workspaces: StructuredWorkspaces) {
	const name = required(args.workspace, "workspace");
	const workspace = workspaces.get(name);
	if (!workspace)
		return text(`Structured Workspace "${name}" not found.`, true);
	return text(JSON.stringify(workspace, null, 2));
}

function runCreate(args: Args, workspaces: StructuredWorkspaces) {
	const name = required(args.workspace, "workspace");
	const workspace = workspaces.create({
		name,
		description: args.description,
		dataSchema: requiredValue(
			args.data_schema,
			"data_schema",
		) as StructuredWorkspaceDataSchema,
		representationSchema: requiredValue(
			args.representation_schema,
			"representation_schema",
		) as StructuredWorkspaceRepresentationSchema,
	});
	return text(`Structured Workspace "${workspace.name}" created.`, {
		next: [
			`maket_structured_workspace action=add_item workspace=${workspace.name} collection=<collection> binding=<binding> document_name=<name> data=<json>`,
		],
	});
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
