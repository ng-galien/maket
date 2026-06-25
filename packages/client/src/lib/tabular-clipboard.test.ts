import type { Collection } from "@maket/shared";
import { describe, expect, it } from "vitest";
import { applyPastedTable, parseTabularClipboard } from "./tabular-clipboard";

const collection: Collection = {
	name: "clients",
	schema: {
		type: "object",
		properties: {
			client_name: { type: "string", title: "Client" },
			offer_summary: { type: "string", title: "Offre" },
		},
		required: ["client_name"],
		additionalProperties: false,
	},
	members: [
		{
			id: "member_1",
			position: 0,
			data: { client_name: "Acme", offer_summary: "Audit" },
		},
	],
};

describe("parseTabularClipboard", () => {
	it("parses spreadsheet TSV", () => {
		expect(parseTabularClipboard("a\tb\nc\td\n")).toEqual([
			["a", "b"],
			["c", "d"],
		]);
	});

	it("parses quoted CSV cells", () => {
		expect(parseTabularClipboard('"Acme, Inc","Audit ""premium"""')).toEqual([
			["Acme, Inc", 'Audit "premium"'],
		]);
	});
});

describe("applyPastedTable", () => {
	it("pastes cells from the anchor field", () => {
		const next = applyPastedTable(
			collection,
			{ memberId: "member_1", fieldKey: "offer_summary" },
			[["Refonte"]],
		);

		expect(next.members[0]?.data).toEqual({
			client_name: "Acme",
			offer_summary: "Refonte",
		});
	});

	it("maps header rows and creates missing schema fields", () => {
		const next = applyPastedTable(
			collection,
			{ memberId: "member_1", fieldKey: "client_name" },
			[
				["client_name", "budget"],
				["Acme", "12000"],
				["Globex", "30000"],
			],
		);

		expect(next.schema.properties).toMatchObject({
			client_name: { type: "string" },
			budget: { type: "string", title: "Budget" },
		});
		expect(next.members).toEqual([
			expect.objectContaining({
				id: "member_1",
				position: 0,
				data: expect.objectContaining({
					client_name: "Acme",
					offer_summary: "Audit",
					budget: "12000",
				}),
			}),
			expect.objectContaining({
				id: "member_2",
				position: 1,
				data: { client_name: "Globex", budget: "30000" },
			}),
		]);
	});
});
