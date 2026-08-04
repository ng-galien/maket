import type { DocumentStateData, DocumentStateSchema } from "@maket/shared";
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

const StateSchema = z.object({
	action: z.enum([
		"init",
		"get",
		"update",
		"history",
		"revision",
		"restore",
		"diff",
	]),
	doc: z.string(),
	schema: z.record(z.string(), z.unknown()).optional(),
	data: z.record(z.string(), z.unknown()).optional(),
	expected_revision: z.number().int().positive().optional(),
	revision: z.number().int().positive().optional(),
	from_revision: z.number().int().positive().optional(),
	to_revision: z.number().int().positive().optional(),
});

const DESCRIPTION = [
	"When to use: attach durable data and immutable snapshot history to one living document.",
	"",
	"Document state is separate from collections and mail merge. A state-backed document renders {{ state.field }} placeholders from its latest revision. Each update stores a complete validated snapshot; diffs are computed on demand and never persisted.",
	"  init     — attach a schema and initial data to a static document (revision 1).",
	"  get      — read the schema and current revision.",
	"  update   — append a complete state snapshot; expected_revision is required.",
	"  history  — list immutable revisions newest first.",
	"  revision — read one revision.",
	"  restore  — append a new revision containing an older snapshot.",
	"  diff     — compute JSON-pointer differences between two revisions.",
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

// code-moniker: ignore[smell-feature-envy-local]
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
	return action === "init" || action === "update" || action === "restore";
}

// code-moniker: ignore[smell-feature-envy-local]
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
		case "diff": {
			const differences = states.diff(
				args.doc,
				requiredPositive(args.from_revision, "from_revision"),
				requiredPositive(args.to_revision, "to_revision"),
			);
			return text(JSON.stringify(differences, null, 2));
		}
	}
}

function requiredSchema(args: Args): DocumentStateSchema {
	if (!args.schema) throw new Error("schema is required for action=init");
	return args.schema;
}

function requiredData(args: Args): DocumentStateData {
	if (!args.data) throw new Error(`data is required for action=${args.action}`);
	return args.data;
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
