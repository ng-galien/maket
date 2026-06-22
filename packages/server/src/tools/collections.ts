import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import type { Collections } from "../services/collections.js";
import { text } from "./_helpers.js";

export interface CollectionsToolDeps {
	collections: Collections;
}

const MemberSchema = z.object({
	id: z.string(),
	position: z.number().int().nonnegative(),
	data: z.record(z.string(), z.unknown()),
});

const CollectionSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	schema: z.record(z.string(), z.unknown()),
	members: z.array(MemberSchema),
});

const MaketCollectionSchema = z.object({
	action: z.enum(["list", "view", "set", "delete", "bind"]),
	name: z.string().optional(),
	collection: CollectionSchema.optional(),
	doc: z.string().optional(),
	page: z.number().int().positive().optional(),
});

const DESCRIPTION = [
	"When to use: manage data collections used by page placeholders.",
	"",
	"Collections are typed by JSON Schema and contain ordered members. A page can be bound to one collection; rendering then produces one page per member.",
	"  list   — list collections.",
	"  view   — read one collection with fields and members.",
	"  set    — create or replace a collection.",
	"  delete — remove a collection.",
	"  bind   — bind a collection to a document page.",
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
		handler: async (rawArgs) => {
			const args = MaketCollectionSchema.parse(rawArgs);
			switch (args.action) {
				case "list":
					return runList(collections);
				case "view":
					return runView(args, collections);
				case "set":
					return runSet(args, collections);
				case "delete":
					return runDelete(args, collections);
				case "bind":
					return runBind(args, collections);
			}
		},
	};
}

type Args = z.infer<typeof MaketCollectionSchema>;

function runList(collections: Collections) {
	const list = collections.list();
	if (list.length === 0) {
		return text("No collections. Use maket_collection set to create one.");
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

function runSet(args: Args, collections: Collections) {
	if (!args.collection)
		return text("collection is required for action=set", true);
	collections.save(args.collection);
	return text(
		`Collection "${args.collection.name}" saved with ${args.collection.members.length} member(s).`,
		{
			next: [
				`maket_collection bind doc=<doc> page=<page> name=${args.collection.name}`,
				"maket_html set doc=<doc> page=<page> html='<h1>{{ field_name }}</h1>'",
			],
		},
	);
}

function runDelete(args: Args, collections: Collections) {
	if (!args.name) return text("name is required for action=delete", true);
	let deleted: boolean;
	try {
		deleted = collections.delete(args.name);
	} catch (error) {
		return text(error instanceof Error ? error.message : String(error), true);
	}
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
