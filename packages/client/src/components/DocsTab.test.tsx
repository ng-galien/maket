import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { DocSummary } from "../store/types";
import { useStore } from "../store/useStore";
import { sendPinDoc } from "../store/ws";
import { DocsTab } from "./DocsTab";

vi.mock("../store/ws", async (importOriginal) => ({
	...(await importOriginal<typeof import("../store/ws")>()),
	sendPinDoc: vi.fn(),
}));

function summary(
	name: string,
	category: string,
	pinnedAt?: string,
): DocSummary {
	return {
		id: `id-${name}`,
		name,
		category,
		format: "A4",
		pageCount: 1,
		elementCount: 0,
		collectionBindings: [],
		...(pinnedAt ? { pinnedAt } : {}),
	};
}

const DOCS = [
	summary("dossier", "clients", "2026-10-10T08:00:00.000Z"),
	summary("notes", "archive"),
	summary("synthesis", "reports", "2026-10-10T09:00:00.000Z"),
	summary("budget", "reports"),
];

beforeEach(() => {
	setLang("en");
	localStorage.clear();
	useStore.setState({
		docList: DOCS,
		workspaceDocNames: [],
		focusedDocName: null,
		readOnly: false,
	});
});

afterEach(() => {
	cleanup();
	vi.mocked(sendPinDoc).mockClear();
	useStore.setState({ docList: [], readOnly: false });
});

function rowNames(container: ParentNode): string[] {
	return [...container.querySelectorAll("[data-doc-row]")].map(
		(row) => row.getAttribute("data-doc-row") ?? "",
	);
}

describe("DocsTab pinned documents", () => {
	it("shows pinned documents as a first group, most recently pinned first", () => {
		const { container } = render(<DocsTab />);

		const pinned = screen.getByRole("region", { name: "Pinned" });
		expect(rowNames(pinned)).toEqual(["synthesis", "dossier"]);
		expect(rowNames(container)).toEqual([
			"synthesis",
			"dossier",
			"notes",
			"budget",
		]);
		expect(
			container.querySelector('[data-category-path="clients"]'),
		).toBeNull();
	});

	it("toggles a pin from the keyboard on each row", async () => {
		const user = userEvent.setup();
		render(<DocsTab />);

		const pinBudget = screen.getByRole("button", { name: "Pin budget" });
		expect(pinBudget).toHaveAttribute("aria-pressed", "false");
		pinBudget.focus();
		await user.keyboard("{Enter}");
		expect(sendPinDoc).toHaveBeenLastCalledWith("budget", true);

		const unpinSynthesis = within(
			screen.getByRole("region", { name: "Pinned" }),
		).getByRole("button", { name: "Pin synthesis" });
		expect(unpinSynthesis).toHaveAttribute("aria-pressed", "true");
		unpinSynthesis.focus();
		await user.keyboard(" ");
		expect(sendPinDoc).toHaveBeenLastCalledWith("synthesis", false);
	});

	it("marks pinned documents without a toggle in a read-only context", () => {
		useStore.setState({ readOnly: true });
		render(<DocsTab />);

		expect(screen.queryByRole("button", { name: /^Pin / })).toBeNull();
		expect(
			within(screen.getByRole("region", { name: "Pinned" })).getAllByRole(
				"img",
				{ name: "Pinned document" },
			),
		).toHaveLength(2);
	});
});
