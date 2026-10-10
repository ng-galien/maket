import type { Collection } from "@maket/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { LinkedDocumentView } from "./LinkedDocumentView";

const clients: Collection = {
	name: "clients",
	schema: {
		type: "object",
		properties: { name: { type: "string" } },
		required: ["name"],
		additionalProperties: false,
	},
	members: [
		{ id: "one", position: 0, data: { name: "One" } },
		{ id: "two", position: 1, data: { name: "Two" } },
		{ id: "three", position: 2, data: { name: "Three" } },
	],
};

function collectionDoc(): Document {
	return {
		id: "doc-letters",
		name: "letters",
		category: "tests",
		dataModel: "collection",
		canvas: { w: 100, h: 100, background: "#fff" },
		pages: [
			{ id: "cover", name: "Cover", elements: [], html: "<p>Cover</p>" },
			{
				id: "letter",
				name: "Letter",
				elements: [],
				html: "<p>{{name}}</p>",
				collection: { name: "clients" },
			},
		],
		activePage: 0,
	};
}

beforeEach(() => setLang("en"));

afterEach(() => {
	cleanup();
	useStore.setState({
		docs: new Map(),
		docList: [],
		collections: [],
		readOnly: false,
	});
});

describe("LinkedDocumentView", () => {
	it("counts and navigates the logical Reader pages of a collection document", () => {
		const doc = collectionDoc();
		useStore.setState({
			connected: false,
			settingsHydrated: true,
			docs: new Map([[doc.name, doc]]),
			docList: [],
			collections: [clients],
		});
		render(<LinkedDocumentView documentId={doc.id} />);

		expect(screen.getByText("1/4")).toBeVisible();
		const next = screen.getByRole("button", { name: "Next page" });
		for (let step = 0; step < 5; step += 1) fireEvent.click(next);
		expect(screen.getByText("4/4")).toBeVisible();
		expect(next).toBeDisabled();
	});
});
