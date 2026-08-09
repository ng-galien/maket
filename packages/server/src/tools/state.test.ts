import type { CallToolResult } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createBus } from "../services/bus.js";
import { createDocumentStates } from "../services/document-states.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketStateTool, statePack } from "./state.js";

function textOf(result: CallToolResult) {
	return result.content
		.filter(
			(item): item is Extract<typeof item, { type: "text" }> =>
				item.type === "text",
		)
		.map((item) => item.text)
		.join("\n");
}

describe("maket_state", () => {
	it("registers a dedicated state tool pack", () => {
		expect(statePack.declaresTools).toEqual(["maket_state"]);
		expect(statePack.requires).toEqual(["documentStates", "documents"]);
	});

	it("runs the snapshot lifecycle through the MCP boundary", async () => {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const documents = createDocuments({ store });
		const doc = createDocument({
			name: "checklist",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
		});
		documents.all().set(doc.name, doc);
		documents.persist(doc.name);
		const documentStates = createDocumentStates({ store, documents, bus });
		const tool = createMaketStateTool({ documentStates, documents });

		const initial = await tool.handler(
			{
				action: "init",
				doc: "checklist",
				schema: {
					type: "object",
					properties: { done: { type: "boolean" } },
					required: ["done"],
				},
				data: { done: false },
			},
			{} as never,
		);
		expect(textOf(initial)).toContain("revision 1");

		const updated = await tool.handler(
			{
				action: "update",
				doc: "checklist",
				expected_revision: 1,
				data: { done: true },
			},
			{} as never,
		);
		expect(textOf(updated)).toContain("revision 2");

		const patched = await tool.handler(
			{
				action: "patch",
				doc: "checklist",
				expected_revision: 2,
				patch: [{ op: "replace", path: "/done", value: false }],
			},
			{} as never,
		);
		expect(textOf(patched)).toContain("revision 3");

		const nextSchema = {
			type: "object",
			properties: {
				done: { type: "boolean" },
				label: { type: "string" },
			},
			required: ["done", "label"],
		};
		const validated = await tool.handler(
			{
				action: "validate_schema",
				doc: "checklist",
				schema: nextSchema,
				data: { done: false, label: "Open" },
			},
			{} as never,
		);
		expect(textOf(validated)).toContain("Schema is valid");
		const schemaChanged = await tool.handler(
			{
				action: "change_schema",
				doc: "checklist",
				expected_revision: 3,
				schema: nextSchema,
				data: { done: false, label: "Open" },
			},
			{} as never,
		);
		expect(textOf(schemaChanged)).toContain("revision 4");
		expect(documentStates.revision("checklist", 4)).toMatchObject({
			schema: nextSchema,
			data: { done: false, label: "Open" },
		});
		const restored = await tool.handler(
			{
				action: "restore",
				doc: "checklist",
				revision: 3,
				expected_revision: 4,
			},
			{} as never,
		);
		expect(textOf(restored)).toContain("revision 5");
		expect(documentStates.get("checklist")?.current).toMatchObject({
			revision: 5,
			schema: {
				type: "object",
				properties: { done: { type: "boolean" } },
				required: ["done"],
			},
			data: { done: false },
		});

		doc.meta.locked = true;
		const locked = await tool.handler(
			{
				action: "update",
				doc: "checklist",
				expected_revision: 5,
				data: { done: false },
			},
			{} as never,
		);
		expect(locked.isError).toBe(true);
		expect(textOf(locked)).toContain("is locked");
		store.close();
	});
});
