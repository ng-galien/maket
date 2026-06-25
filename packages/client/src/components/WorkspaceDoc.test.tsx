import type { Collection } from "@maket/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { WorkspaceDoc } from "./WorkspaceDoc";

const collection: Collection = {
	name: "clients",
	schema: {
		type: "object",
		properties: { client_name: { type: "string" } },
		required: ["client_name"],
		additionalProperties: false,
	},
	members: [{ id: "member_1", position: 0, data: { client_name: "Acme" } }],
};

beforeEach(() => {
	setLang("en");
});

afterEach(() => {
	cleanup();
	useStore.setState({
		docs: new Map(),
		workspaceDocNames: [],
		focusedDocName: null,
		focusedCollectionName: null,
		collections: [],
		collectionPreview: {},
		collectionDrafts: {},
		selectedIds: [],
	});
});

describe("WorkspaceDoc collection controls", () => {
	it("opens the bound collection data view without closing document focus", () => {
		const doc = makeDoc();
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			collections: [collection],
			collectionPreview: {
				clients: { mode: "template", memberId: "member_1" },
			},
		});

		render(<WorkspaceDoc docName={doc.name} zoomK={1} />);
		fireEvent.click(screen.getByRole("button", { name: "Open data" }));

		expect(useStore.getState().focusedDocName).toBe("poster");
		expect(useStore.getState().focusedCollectionName).toBe("clients");
	});
});

function makeDoc(): Document {
	return {
		id: "doc-1",
		name: "poster",
		category: "smoke",
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: [
			{
				id: "page-1",
				name: "Page 1",
				elements: [],
				html: '<p data-id="title">{{ client_name }}</p>',
				collection: { name: "clients" },
			},
		],
		activePage: 0,
	};
}
