import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../../i18n/useT";
import { LibrarySearchField } from "./LibrarySearchField";

beforeEach(() => setLang("en"));
afterEach(cleanup);

describe("LibrarySearchField", () => {
	it("shares one search control while preserving advanced input semantics", async () => {
		const user = userEvent.setup();
		const onClear = vi.fn();
		render(
			<LibrarySearchField
				value="@clients"
				placeholder="Search documents"
				onChange={vi.fn()}
				onClear={onClear}
				inputProps={{ role: "combobox", "aria-expanded": true }}
			/>,
		);

		const search = screen.getByRole("combobox", {
			name: "Search documents",
		});
		expect(search).toHaveClass("h-8", "rounded-md", "text-sm");
		expect(search).toHaveAttribute("aria-expanded", "true");

		await user.click(screen.getByRole("button", { name: "Clear search" }));
		expect(onClear).toHaveBeenCalledOnce();
	});
});
