/**
 * messages pack — maket_message (compound).
 *
 * Pending messages are user-originated notes/flags attached to a document
 * (deletion markers, drops, review notes). They're surfaced from the client
 * and cleared once the agent has processed them.
 *
 * Deps: `documents` (read _pending), `bus` (messages:acked).
 */

import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import type { Bus } from "../services/bus.js";
import type { Documents } from "../services/documents.js";
import { text } from "./_helpers.js";

export interface MessagesDeps {
	documents: Documents;
	bus: Bus;
}

const ActionSchema = z.enum(["list", "ack"]);

const MaketMessageSchema = z.object({
	action: ActionSchema.describe(
		"Operation to run. See the tool description for the action table.",
	),
	doc: z.string().describe("Document name (always required)."),
	ids: z
		.array(z.string())
		.optional()
		.describe("For ack: message ids to mark processed."),
});

const DESCRIPTION = [
	"When to use: read and clear pending user messages attached to a document (delete flags, drops, review notes). Call list to see what the user flagged, act on it, then ack by id.",
	"",
	"  list — return pending messages as JSON (id, type, target, payload).",
	"  ack  — mark the given ids processed; drops them from the pending queue.",
].join("\n");

export function createMaketMessageTool(deps: MessagesDeps): ToolHandler {
	const { documents, bus } = deps;
	return {
		metadata: {
			name: "maket_message",
			description: DESCRIPTION,
			schema: MaketMessageSchema,
		},
		handler: async (rawArgs) => {
			const args = MaketMessageSchema.parse(rawArgs);
			const doc = documents.resolve(args.doc);
			if (!doc) return text(`Document "${args.doc}" not found`, true);

			if (args.action === "list") {
				const pending = doc._pending || [];
				if (pending.length === 0) return text("No pending messages");
				return text(JSON.stringify(pending, null, 2));
			}

			if (!args.ids) return text("ids is required for action=ack", true);
			const pendingIds = new Set((doc._pending || []).map((m) => m.id));
			const matched = args.ids.filter((id) => pendingIds.has(id));
			const unknown = args.ids.filter((id) => !pendingIds.has(id));
			if (matched.length === 0) {
				return text(
					`No matches: ${args.ids.length} id(s) did not correspond to any pending message. Use maket_message list to see current ids.`,
					true,
				);
			}
			const acked = new Set(matched);
			doc._pending = (doc._pending || []).filter((m) => !acked.has(m.id));
			bus.emit("messages:acked", { ids: matched });
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
	requires: ["documents", "bus"],
	register(container) {
		container.register({
			maketMessageTool: asFunction(createMaketMessageTool).singleton(),
		});
	},
};
