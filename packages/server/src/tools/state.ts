import type {
	DocumentStateData,
	DocumentStateSchema,
	JsonPatchOperation,
} from "@maket/shared";
import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import type { DocumentStates } from "../services/document-states.js";
import type { Documents } from "../services/documents.js";
import { lockGuard, text } from "./_helpers.js";

export interface StateToolDeps {
	documentStates: DocumentStates;
	documents: Documents;
}

const JsonPatchSchema = z.discriminatedUnion("op", [
	z.object({ op: z.literal("add"), path: z.string(), value: z.unknown() }),
	z.object({ op: z.literal("remove"), path: z.string() }),
	z.object({ op: z.literal("replace"), path: z.string(), value: z.unknown() }),
	z.object({ op: z.literal("move"), from: z.string(), path: z.string() }),
	z.object({ op: z.literal("copy"), from: z.string(), path: z.string() }),
	z.object({ op: z.literal("test"), path: z.string(), value: z.unknown() }),
]);

const StateSchema = z.object({
	action: z
		.enum([
			"init",
			"get",
			"update",
			"patch",
			"validate_schema",
			"change_schema",
			"history",
			"revision",
			"restore",
		])
		.describe("Document-state operation to perform."),
	doc: z.string().describe("Target document name."),
	schema: z
		.record(z.string(), z.unknown())
		.optional()
		.describe(
			"JSON Schema required by init, validate_schema, and change_schema.",
		),
	data: z
		.record(z.string(), z.unknown())
		.optional()
		.describe(
			"Complete state object required by init/update; optional compatible data for schema validation/change.",
		),
	patch: z
		.array(JsonPatchSchema)
		.min(1)
		.optional()
		.describe("RFC 6902 operations required by action=patch."),
	expected_revision: z
		.number()
		.int()
		.positive()
		.optional()
		.describe(
			"Current revision required by update, patch, change_schema, and restore; not used by init.",
		),
	revision: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Historical revision required by revision and restore."),
});

const DESCRIPTION = [
	"When to use: attach durable data and immutable snapshot history to one living document.",
	"",
	"Document state is separate from collections and mail merge. A state-backed document renders Mustache variables, sections, inverted sections, and loops from its latest revision. Every mutation stores a complete validated schema + data snapshot.",
	'The target interface is document-owned standard HTML/CSS: Mustache interpolation is display-only. Editable terminal values must be declared explicitly with data-maket-bind on <input type="checkbox"> (boolean), <input type="text"> (string), <select> (string enum), or <button type="button"> (single-value editor). Use state.foo at the root and relative foo inside {{#state.items}} sections. Maket resolves transient JSON Pointers and synchronizes the store; it does not generate or style controls.',
	"  init     — attach a schema and initial data to a static document (revision 1; no expected_revision).",
	"  get      — read the schema and current revision.",
	"  update   — append a complete state snapshot; expected_revision is required.",
	"  patch    — apply RFC 6902 JSON Patch operations; expected_revision is required.",
	"  validate_schema — validate a proposed schema against current or supplied data without saving.",
	"  change_schema — atomically replace the schema and append compatible data; expected_revision is required.",
	"  history  — list immutable revisions newest first.",
	"  revision — read one revision.",
	"  restore  — append a new revision containing an older schema + data snapshot; expected_revision is required.",
].join("\n");

type Args = z.infer<typeof StateSchema>;

export function createMaketStateTool({
	documentStates,
	documents,
}: StateToolDeps): ToolHandler {
	return {
		metadata: {
			name: "maket_state",
			description: DESCRIPTION,
			schema: StateSchema,
		},
		handler: async (rawArgs) =>
			handleStateTool(rawArgs, documentStates, documents),
	};
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP edge validates input, applies the cross-cutting lock, then delegates.
function handleStateTool(
	rawArgs: unknown,
	documentStates: DocumentStates,
	documents: Documents,
) {
	const parsed = StateSchema.safeParse(rawArgs);
	if (!parsed.success) {
		return text(
			parsed.error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("\n"),
			true,
		);
	}
	try {
		if (isMutation(parsed.data.action)) {
			const doc = documents.resolveOrLoad(parsed.data.doc);
			if (doc) {
				const locked = lockGuard(doc);
				if (locked) return locked;
			}
		}
		return runStateAction(parsed.data, documentStates);
	} catch (error) {
		return text(error instanceof Error ? error.message : String(error), true);
	}
}

function isMutation(action: Args["action"]): boolean {
	return (
		action === "init" ||
		action === "update" ||
		action === "patch" ||
		action === "change_schema" ||
		action === "restore"
	);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP dispatcher translates action contracts into the dedicated domain service.
function runStateAction(args: Args, states: DocumentStates) {
	switch (args.action) {
		case "init": {
			const schema = requiredSchema(args);
			const data = requiredData(args);
			const state = states.initialize(args.doc, schema, data);
			return text(
				`State attached to "${args.doc}" at revision ${state.current.revision}.`,
				{
					next: [
						`maket_state action=get doc=${args.doc}`,
						`maket_pdf doc=${args.doc}`,
					],
				},
			);
		}
		case "get": {
			const state = states.get(args.doc);
			if (!state) return text(`Document "${args.doc}" has no state.`, true);
			return text(
				JSON.stringify(
					{
						doc: args.doc,
						schema: state.definition.schema,
						current: state.current,
					},
					null,
					2,
				),
			);
		}
		case "update": {
			const revision = states.update(
				args.doc,
				requiredExpectedRevision(args),
				requiredData(args),
			);
			return text(
				`State of "${args.doc}" updated to revision ${revision.revision}.`,
			);
		}
		case "patch": {
			const revision = states.patch(
				args.doc,
				requiredExpectedRevision(args),
				requiredPatch(args),
			);
			return text(
				`State of "${args.doc}" patched to revision ${revision.revision}.`,
			);
		}
		case "validate_schema": {
			states.validateSchema(args.doc, requiredSchema(args), args.data);
			return text(`Schema is valid for "${args.doc}".`);
		}
		case "change_schema": {
			const revision = states.changeSchema(
				args.doc,
				requiredExpectedRevision(args),
				requiredSchema(args),
				args.data,
			);
			return text(
				`Schema of "${args.doc}" changed at revision ${revision.revision}.`,
			);
		}
		case "history": {
			const revisions = states.history(args.doc);
			return text(
				revisions
					.map(
						(revision) =>
							`- revision ${revision.revision} — ${revision.createdAt}`,
					)
					.join("\n") || "No revisions.",
			);
		}
		case "revision": {
			const number = requiredRevision(args);
			const revision = states.revision(args.doc, number);
			if (!revision) {
				return text(`Revision ${number} not found for "${args.doc}".`, true);
			}
			return text(JSON.stringify(revision, null, 2));
		}
		case "restore": {
			const revision = states.restore(
				args.doc,
				requiredRevision(args),
				requiredExpectedRevision(args),
			);
			return text(
				`State of "${args.doc}" restored as revision ${revision.revision}.`,
			);
		}
	}
}

function requiredSchema(args: Args): DocumentStateSchema {
	if (!args.schema)
		throw new Error(`schema is required for action=${args.action}`);
	return args.schema;
}

function requiredData(args: Args): DocumentStateData {
	if (!args.data) throw new Error(`data is required for action=${args.action}`);
	return args.data;
}

function requiredPatch(args: Args): JsonPatchOperation[] {
	if (!args.patch) throw new Error("patch is required for action=patch");
	return args.patch;
}

function requiredExpectedRevision(args: Args): number {
	return requiredPositive(args.expected_revision, "expected_revision");
}

function requiredRevision(args: Args): number {
	return requiredPositive(args.revision, "revision");
}

function requiredPositive(value: number | undefined, field: string): number {
	if (!value) throw new Error(`${field} is required`);
	return value;
}

export const statePack: ToolPack = {
	id: "state",
	name: "Document state",
	requires: ["documentStates", "documents"],
	declaresTools: ["maket_state"],
	register(container) {
		container.register({
			maketStateTool: asFunction(createMaketStateTool).singleton(),
		});
	},
};
