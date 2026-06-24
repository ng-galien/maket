import {
	formatCollectionTemplateIssues,
	type CollectionSchema as MaketCollectionJsonSchema,
} from "@maket/shared";
import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import type {
	CollectionSchemaValidation,
	Collections,
} from "../services/collections.js";
import { text } from "./_helpers.js";

export interface CollectionsToolDeps {
	collections: Collections;
}

const MaketCollectionSchema = z.object({
	action: z.enum([
		"list",
		"view",
		"create",
		"validate_schema",
		"change_schema",
		"add_row",
		"update_row",
		"delete_row",
		"delete",
		"bind",
		"unbind",
	]),
	name: z.string().optional(),
	description: z.string().optional(),
	schema: z.record(z.string(), z.unknown()).optional(),
	data: z.record(z.string(), z.unknown()).optional(),
	row: z.string().optional(),
	doc: z.string().optional(),
	page: z.number().int().positive().optional(),
});

const DESCRIPTION = [
	"When to use: manage data collections used by page placeholders.",
	"",
	"Collections are typed by JSON Schema and contain ordered members. A page can be bound to one collection; rendering then produces one page per member.",
	"  list   — list collections.",
	"  view   — read one collection with fields and members.",
	"  create — create an empty collection from a JSON Schema.",
	"  validate_schema — check a schema against existing members without saving.",
	"  change_schema — apply a schema only when existing members validate.",
	"  add_row / update_row / delete_row — edit collection members.",
	"  delete — remove a collection.",
	"  bind / unbind — bind or clear a collection on a document page.",
].join("\n");

export function createMaketCollectionTool({
	collections,
}: CollectionsToolDeps): ToolHandler {
	return {
		metadata: {
			name: "maket_collection",
			description: DESCRIPTION,
			schema: MaketCollectionSchema,
		},
		handler: async (rawArgs) => handleCollectionTool(rawArgs, collections),
	};
}

type Args = z.infer<typeof MaketCollectionSchema>;

function handleCollectionTool(rawArgs: unknown, collections: Collections) {
	const parsed = MaketCollectionSchema.safeParse(rawArgs);
	if (!parsed.success) return text(zodErrors(parsed.error), true);
	return runCollectionAction(parsed.data, collections);
}

function runCollectionAction(args: Args, collections: Collections) {
	try {
		return dispatchCollectionAction(args, collections);
	} catch (error) {
		return text(error instanceof Error ? error.message : String(error), true);
	}
}

function dispatchCollectionAction(args: Args, collections: Collections) {
	if (args.action === "list") return runList(collections);
	if (args.action === "view") return runView(args, collections);
	if (args.action === "create") return runCreate(args, collections);
	if (args.action === "validate_schema")
		return runValidateSchema(args, collections);
	if (args.action === "change_schema")
		return runChangeSchema(args, collections);
	if (args.action === "add_row") return runAddRow(args, collections);
	if (args.action === "update_row") return runUpdateRow(args, collections);
	if (args.action === "delete_row") return runDeleteRow(args, collections);
	if (args.action === "delete") return runDelete(args, collections);
	if (args.action === "bind") return runBind(args, collections);
	return runUnbind(args, collections);
}

function runList(collections: Collections) {
	const list = collections.list();
	if (list.length === 0) {
		return text(
			"No collections. Use maket_collection action=create to create one.",
		);
	}
	return text(
		`Collections (${list.length}):\n${list
			.map(
				(collection) =>
					`- ${collection.name}: ${collection.fieldCount} field(s), ${collection.memberCount} member(s)${collection.description ? ` — ${collection.description}` : ""}`,
			)
			.join("\n")}`,
	);
}

function runView(args: Args, collections: Collections) {
	if (!args.name) return text("name is required for action=view", true);
	const collection = collections.resolve(args.name);
	if (!collection) return text(`Collection not found: "${args.name}"`, true);
	const fields = collections.fields(args.name);
	const lines = [
		`Collection: "${collection.name}"${collection.description ? ` — ${collection.description}` : ""}`,
		`Fields (${fields.length}):`,
		...fields.map(
			(field) =>
				`- ${field.key}: ${field.type}${field.required ? ", required" : ""}${field.title ? ` — ${field.title}` : ""}`,
		),
		`Members (${collection.members.length}):`,
		...collection.members
			.slice()
			.sort((a, b) => a.position - b.position)
			.map((member) => `- ${member.id}: ${JSON.stringify(member.data)}`),
	];
	return text(lines.join("\n"));
}

function runCreate(args: Args, collections: Collections) {
	const name = requiredName(args, "create");
	const schema = requiredSchema(args, "create");
	const collection = collections.create(name, schema, args.description);
	return text(`Collection "${collection.name}" created.`, {
		next: [
			`maket_collection action=add_row name=${collection.name} data='{"field_name":"value"}'`,
			`maket_collection action=bind doc=<doc> page=<page> name=${collection.name}`,
		],
	});
}

function runValidateSchema(args: Args, collections: Collections) {
	const name = requiredName(args, "validate_schema");
	const result = collections.validateSchema(
		name,
		requiredSchema(args, "validate_schema"),
	);
	return schemaValidationText(name, result, false);
}

function runChangeSchema(args: Args, collections: Collections) {
	const name = requiredName(args, "change_schema");
	const result = collections.changeSchema(
		name,
		requiredSchema(args, "change_schema"),
	);
	return schemaValidationText(name, result, true);
}

function runAddRow(args: Args, collections: Collections) {
	const name = requiredName(args, "add_row");
	const data = requiredData(args, "add_row");
	const collection = collections.addRow(name, data, args.row);
	const member = collection.members.at(-1);
	return text(
		`Row "${member?.id ?? ""}" added to collection "${collection.name}".`,
	);
}

function runUpdateRow(args: Args, collections: Collections) {
	const name = requiredName(args, "update_row");
	const row = requiredRow(args, "update_row");
	const data = requiredData(args, "update_row");
	collections.updateRow(name, row, data);
	return text(`Row "${row}" updated in collection "${name}".`);
}

function runDeleteRow(args: Args, collections: Collections) {
	const name = requiredName(args, "delete_row");
	const row = requiredRow(args, "delete_row");
	collections.deleteRow(name, row);
	return text(`Row "${row}" deleted from collection "${name}".`);
}

function runDelete(args: Args, collections: Collections) {
	if (!args.name) return text("name is required for action=delete", true);
	const deleted = collections.delete(args.name);
	if (!deleted) return text(`Collection not found: "${args.name}"`, true);
	return text(`Collection "${args.name}" deleted.`);
}

function runBind(args: Args, collections: Collections) {
	if (!args.name) return text("name is required for action=bind", true);
	if (!args.doc) return text("doc is required for action=bind", true);
	if (!args.page) return text("page is required for action=bind", true);
	const doc = collections.bindPage(args.doc, args.page - 1, args.name);
	const fields = collections.fields(args.name);
	return text(
		`Collection "${args.name}" bound to "${doc.name}" page ${args.page}.`,
		{
			next: [
				`maket_html get doc=${doc.name} page=${args.page}`,
				`maket_html set doc=${doc.name} page=${args.page} html='<h1>{{ ${fields[0]?.key ?? "field_name"} }}</h1>'`,
			],
		},
	);
}

function runUnbind(args: Args, collections: Collections) {
	if (!args.doc) return text("doc is required for action=unbind", true);
	if (!args.page) return text("page is required for action=unbind", true);
	const doc = collections.clearPageBinding(args.doc, args.page - 1);
	return text(`Collection binding cleared on "${doc.name}" page ${args.page}.`);
}

function schemaValidationText(
	name: string,
	result: CollectionSchemaValidation,
	applied: boolean,
) {
	if (!result.valid) {
		return text(
			`Schema rejected for collection "${name}":\n${formatCollectionTemplateIssues(result.issues)}`,
			true,
		);
	}
	return text(
		applied
			? `Schema applied to collection "${name}".`
			: `Schema validates existing rows for collection "${name}".`,
	);
}

function requiredName(args: Args, action: string): string {
	if (!args.name) throw new Error(`name is required for action=${action}`);
	return args.name;
}

function requiredRow(args: Args, action: string): string {
	if (!args.row) throw new Error(`row is required for action=${action}`);
	return args.row;
}

function requiredSchema(args: Args, action: string): MaketCollectionJsonSchema {
	if (!args.schema) throw new Error(`schema is required for action=${action}`);
	return args.schema;
}

function requiredData(args: Args, action: string): Record<string, unknown> {
	if (!args.data) throw new Error(`data is required for action=${action}`);
	return args.data;
}

function zodErrors(error: z.ZodError): string {
	return error.issues
		.map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`)
		.join("\n");
}

export const collectionsPack: ToolPack = {
	id: "collections",
	name: "Collections",
	requires: ["collections"],
	declaresTools: ["maket_collection"],
	register(container) {
		container.register({
			maketCollectionTool: asFunction(createMaketCollectionTool).singleton(),
		});
	},
};
