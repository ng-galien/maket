import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocSummary, Document } from "../store/types";
import { useStore } from "../store/useStore";
import { DocsTab } from "./DocsTab";

function doc(name: string): Document {
	return {
		id: `id-${name}`,
		name,
		category: "reports",
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: [{ id: `${name}-page`, name: "Page 1", elements: [] }],
		activePage: 0,
	};
}

function summary(name: string): DocSummary {
	return {
		id: `id-${name}`,
		name,
		category: "reports",
		format: "A4",
		pageCount: 1,
		elementCount: 0,
	};
}

beforeEach(() => {
	localStorage.clear();
	const alpha = doc("alpha");
	const beta = doc("beta");
	useStore.setState({
		docs: new Map([
			[alpha.name, alpha],
			[beta.name, beta],
		]),
		docList: [summary(alpha.name), summary(beta.name)],
		workspaceDocNames: [alpha.name, beta.name],
		focusedDocName: alpha.name,
		focusedPageIndex: 0,
		workspaceView: "reading",
	});
});

afterEach(cleanup);

describe("DocsTab reading navigation", () => {
	it("focuses an already-open document instead of removing it", async () => {
		const user = userEvent.setup();
		render(<DocsTab />);

		await user.click(screen.getByRole("button", { name: /beta A4/ }));

		expect(useStore.getState().focusedDocName).toBe("beta");
		expect(useStore.getState().workspaceDocNames).toEqual(["alpha", "beta"]);
	});
});
