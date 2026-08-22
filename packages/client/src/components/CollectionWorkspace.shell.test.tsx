import type { Collection } from "@maket/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import { useStore } from "../store/useStore";
import {
	CollectionWorkspace,
	selectCollectionWorkspaceLayout,
} from "./CollectionWorkspace";

const collection: Collection = {
	name: "clients",
	schema: {
		type: "object",
		properties: { name: { type: "string" } },
		required: ["name"],
		additionalProperties: false,
	},
	members: [{ id: "one", position: 0, data: { name: "Acme" } }],
};

beforeEach(() => {
	setLang("en");
	useStore.setState({
		readOnly: false,
		collections: [collection],
		collectionDrafts: {},
		focusedCollectionName: collection.name,
		dataDockMode: "split",
		focusedDocName: null,
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("CollectionWorkspace shell", () => {
	it("renders the existing editor inside a resizable bottom dock", () => {
		const { container } = render(<CollectionWorkspace />);
		expect(container.querySelector("[data-collection-dock]")).not.toBeNull();
		expect(
			screen.getByRole("separator", { name: "Resize collection panel" }),
		).toHaveAttribute("aria-orientation", "horizontal");
		expect(screen.getByText("clients")).toBeInTheDocument();
	});

	it("does not expose a redundant data-area expansion control", () => {
		render(<CollectionWorkspace />);
		expect(
			screen.queryByRole("button", { name: "Expand data area" }),
		).toBeNull();
	});

	it("supports fast keyboard resizing", () => {
		render(<CollectionWorkspace />);
		const separator = screen.getByRole("separator", {
			name: "Resize collection panel",
		});
		const before = Number(separator.getAttribute("aria-valuenow"));
		fireEvent.keyDown(separator, { key: "ArrowUp" });
		expect(Number(separator.getAttribute("aria-valuenow"))).toBe(before + 24);
	});

	it("distinguishes linked document previews from autonomous data editing", () => {
		const doc = {
			id: "doc",
			name: "Badges",
			category: "events",
			canvas: { w: 210, h: 297, background: "#fff" },
			pages: [
				{
					id: "page",
					name: "Badge",
					elements: [],
					collection: { name: "clients" },
				},
			],
			activePage: 0,
		};
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			focusedDocName: doc.name,
			focusedPageIndex: 0,
			dataDockMode: "expanded",
		});
		expect(selectCollectionWorkspaceLayout(useStore.getState())).toBe(
			"expanded-linked",
		);

		useStore.setState({ focusedCollectionName: "another-collection" });
		expect(selectCollectionWorkspaceLayout(useStore.getState())).toBe(
			"expanded-data",
		);
	});

	it("keeps page binding out of the data workspace", () => {
		const doc = {
			id: "doc",
			name: "Badges",
			category: "events",
			canvas: { w: 210, h: 297, background: "#fff" },
			pages: [{ id: "page", name: "Badge", elements: [] }],
			activePage: 0,
		};
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			focusedDocName: doc.name,
			focusedPageIndex: 0,
		});
		render(<CollectionWorkspace />);

		expect(screen.queryByRole("combobox", { name: "Page binding" })).toBeNull();
		expect(screen.queryByRole("dialog", { name: "Data source" })).toBeNull();
	});

	it("edits schema and typed rows with the existing collection controls", async () => {
		const user = userEvent.setup();
		const editable: Collection = {
			name: "campaigns",
			description: "Initial",
			schema: {
				type: "object",
				properties: {
					name: { type: "string", title: "Name" },
					active: { type: "boolean", title: "Active" },
					tier: { type: "string", enum: ["basic", "pro"], title: "Tier" },
				},
				required: ["name"],
				additionalProperties: false,
			},
			members: [
				{
					id: "member_1",
					position: 0,
					data: { name: "Launch", active: false, tier: "basic" },
				},
			],
		};
		useStore.setState({
			collections: [editable],
			focusedCollectionName: editable.name,
			collectionDrafts: {},
		});
		render(<CollectionWorkspace />);

		await user.click(screen.getByRole("tab", { name: "Schema" }));
		await user.clear(screen.getByPlaceholderText("Description"));
		await user.type(screen.getByPlaceholderText("Description"), "Updated");
		expect(screen.getByRole("button", { name: "Reset changes" })).toBeVisible();

		const newField = screen.getByPlaceholderText("new_field");
		await user.type(newField, "Bad field");
		await user.click(screen.getByRole("button", { name: "Add field" }));
		expect(screen.getByText("Invalid field name.")).toBeVisible();
		await user.clear(newField);
		await user.type(newField, "name");
		await user.click(screen.getByRole("button", { name: "Add field" }));
		expect(screen.getByText("Field already exists.")).toBeVisible();
		await user.clear(newField);
		await user.type(newField, "budget");
		await user.selectOptions(
			screen.getByRole("combobox", { name: "Type" }),
			"number",
		);
		await user.click(screen.getByRole("button", { name: "Add field" }));
		expect(screen.getByText("budget")).toBeVisible();
		await user.click(screen.getByRole("tab", { name: "Data" }));
		await user.click(screen.getByRole("button", { name: "Add row" }));
		const rows = screen.getAllByRole("row");
		expect(rows).toHaveLength(3);

		await user.click(screen.getByRole("tab", { name: "Schema" }));
		await user.click(
			screen.getByRole("button", { name: "Delete field — budget" }),
		);
		expect(screen.queryByText("budget")).toBeNull();
		await user.click(screen.getByRole("button", { name: "Reset changes" }));
		expect(screen.getByDisplayValue("Initial")).toBeVisible();
		await user.click(screen.getByRole("button", { name: "Close" }));
		expect(useStore.getState().focusedCollectionName).toBeNull();
	});
});
