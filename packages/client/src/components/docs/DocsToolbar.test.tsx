import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../../i18n/useT";
import { createToolbarModel, DocsToolbar } from "./DocsToolbar";
import { parseQuery } from "./docsQuery";

beforeEach(() => setLang("en"));
afterEach(() => cleanup());

describe("DocsToolbar search suggestions", () => {
	it("opens category suggestions and commits the active option with Enter", async () => {
		const user = userEvent.setup();
		render(<ToolbarHarness />);
		const search = screen.getByRole("combobox");

		await user.type(search, "@ac");
		expect(search).toHaveAttribute("aria-expanded", "true");
		expect(
			screen.getByRole("option", { name: /@clients\/acme/ }),
		).toBeVisible();

		await user.keyboard("{Enter}");
		expect(search).toHaveValue("@clients/acme ");
		expect(search).toHaveAttribute("aria-expanded", "false");
		expect(
			screen.getByRole("button", { name: /@clients\/acme/ }),
		).toBeVisible();
	});

	it("navigates status suggestions and closes them with Escape", async () => {
		const user = userEvent.setup();
		render(<ToolbarHarness />);
		const search = screen.getByRole("combobox");

		await user.type(search, "#");
		expect(screen.getAllByRole("option")).toHaveLength(2);
		await user.keyboard("{ArrowDown}");
		expect(screen.getByRole("option", { name: /#unlocked/ })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await user.keyboard("{Escape}");
		expect(search).toHaveAttribute("aria-expanded", "false");
	});
});

function ToolbarHarness() {
	const [search, setSearch] = useState("");
	const importInputRef = useRef<HTMLInputElement>(null);
	const model = createToolbarModel({
		search,
		setSearch,
		categories: ["clients", "clients/acme", "products"],
		query: parseQuery(search, { deferLastFilterToken: true }),
		view: "list",
		setView: vi.fn(),
		importState: {
			importInputRef,
			importError: null,
			importDrag: false,
			setImportError: vi.fn(),
			setImportDrag: vi.fn(),
			handleImportFile: vi.fn(async () => {}),
		},
	});
	return <DocsToolbar model={model} />;
}
