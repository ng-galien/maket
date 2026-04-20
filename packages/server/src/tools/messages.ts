/**
 * messages pack — maket_message (compound).
 *
 * User-originated notes and flags captured in the browser, bucketed by the
 * `pending` service. Two scopes:
 *   - doc-scoped: call `list doc=<name>` — element flags, drops, review notes
 *     attached to a specific document.
 *   - workspace-scoped: call `list` with no `doc` — library-wide nudges such
 *     as "classify these newly-imported images".
 *
 * Ack is the same in both cases: `ack ids=[…]` walks both buckets and
 * returns how many matched.
 *
 * Deps: `pending` (queue + ack), `documents` (doc existence check).
 */

import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import type { Documents } from "../services/documents.js";
import type { Pending } from "../services/pending.js";
import { text } from "./_helpers.js";

export interface MessagesDeps {
	documents: Documents;
	pending: Pending;
}

const ActionSchema = z.enum(["list", "ack"]);

const MaketMessageSchema = z.object({
	action: ActionSchema.describe(
		"Operation to run. See the tool description for the action table.",
	),
	doc: z
		.string()
		.optional()
		.describe(
			"For list: document name to scope to. Omit to read workspace-level messages (upload alerts, library nudges). Ignored by ack — ids are globally unique.",
		),
	ids: z
		.array(z.string())
		.optional()
		.describe("For ack: message ids to mark processed."),
});

const DESCRIPTION = [
	"When to use: read and clear pending user messages. Two scopes — pass `doc=<name>` for a document's notes (element flags, drops, review comments) or omit `doc` for workspace-level alerts (new image imports, library-wide nudges). Ack by id once you've acted on the flagged intent.",
	"",
	"  list — with doc: return that document's pending messages. Without doc: return workspace messages.",
	"  ack  — drop the given ids from whichever bucket they live in.",
].join("\n");

export function createMaketMessageTool(deps: MessagesDeps): ToolHandler {
	const { documents, pending } = deps;
	return {
		metadata: {
			name: "maket_message",
			description: DESCRIPTION,
			schema: MaketMessageSchema,
		},
		handler: async (rawArgs) => {
			const args = MaketMessageSchema.parse(rawArgs);

			if (args.action === "list") {
				if (args.doc) {
					const doc = documents.resolve(args.doc);
					if (!doc) return text(`Document "${args.doc}" not found`, true);
					const list = pending.forDoc(doc.name);
					if (list.length === 0) return text("No pending messages");
					return text(JSON.stringify(list, null, 2));
				}
				const list = pending.forWorkspace();
				if (list.length === 0) return text("No pending workspace messages");
				return text(JSON.stringify(list, null, 2));
			}

			if (!args.ids?.length)
				return text("ids is required for action=ack", true);
			const { matched, unknown } = pending.ack(args.ids);
			if (matched.length === 0) {
				return text(
					`No matches: ${args.ids.length} id(s) did not correspond to any pending message. Use maket_message list (optionally with doc=…) to see current ids.`,
					true,
				);
			}
			const suffix =
				unknown.length > 0
					? ` (${unknown.length} unknown id(s) ignored: ${unknown.join(", ")})`
					: "";
			return text(
				`Acknowledged ${matched.length} of ${args.ids.length} message(s)${suffix}.`,
			);
		},
	};
}

export const messagesPack: ToolPack = {
	id: "messages",
	name: "Messages",
	requires: ["documents", "pending"],
	declaresTools: ["maket_message"],
	register(container) {
		container.register({
			maketMessageTool: asFunction(createMaketMessageTool).singleton(),
		});
	},
};
