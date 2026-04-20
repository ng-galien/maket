/**
 * messages pack — maket_message (compound).
 *
 * User-originated notes and flags captured in the browser, bucketed by the
 * `pending` service. `list` returns the full queue across both buckets in
 * one call — each message carries its own `docName` (or none for workspace
 * scope), so the agent can filter client-side without round-trips. `ack`
 * walks both buckets and drops the given ids.
 *
 * Deps: `pending` (queue + ack).
 */

import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import type { Pending } from "../services/pending.js";
import { text } from "./_helpers.js";

export interface MessagesDeps {
	pending: Pending;
}

const ActionSchema = z.enum(["list", "ack"]);

const MaketMessageSchema = z.object({
	action: ActionSchema.describe(
		"Operation to run. See the tool description for the action table.",
	),
	ids: z
		.array(z.string())
		.optional()
		.describe("For ack: message ids to mark processed."),
});

const DESCRIPTION = [
	"When to use: read and clear pending user messages. Each message carries its own `docName` (or none for workspace scope) so a single `list` call returns everything — element flags, drops, review notes, and library-wide alerts (new image imports, classify nudges). Ack by id once you've acted on the flagged intent.",
	"",
	"  list — return every pending message across all docs and the workspace bucket as JSON.",
	"  ack  — drop the given ids from whichever bucket they live in.",
].join("\n");

export function createMaketMessageTool(deps: MessagesDeps): ToolHandler {
	const { pending } = deps;
	return {
		metadata: {
			name: "maket_message",
			description: DESCRIPTION,
			schema: MaketMessageSchema,
		},
		handler: async (rawArgs) => {
			const args = MaketMessageSchema.parse(rawArgs);

			if (args.action === "list") {
				const list = pending.all();
				if (list.length === 0) return text("No pending messages");
				return text(JSON.stringify(list, null, 2));
			}

			if (!args.ids?.length)
				return text("ids is required for action=ack", true);
			const { matched, unknown } = pending.ack(args.ids);
			if (matched.length === 0) {
				return text(
					`No matches: ${args.ids.length} id(s) did not correspond to any pending message. Use maket_message list to see current ids.`,
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
	requires: ["pending"],
	declaresTools: ["maket_message"],
	register(container) {
		container.register({
			maketMessageTool: asFunction(createMaketMessageTool).singleton(),
		});
	},
};
