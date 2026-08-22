import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../../i18n/useT";
import type { DocSummary } from "../../store/types";
import { BulkActionBar } from "./BulkActionBar";

beforeEach(() => setLang("en"));
afterEach(cleanup);

describe("BulkActionBar category picker", () => {
	it("portals a long category menu outside the side panel and makes it scrollable", async () => {
		const user = userEvent.setup();
		const docList = Array.from(
			{ length: 30 },
			(_, index): DocSummary => ({
				id: String(index),
				name: `Document ${index}`,
				category: `Clients/Account ${index}`,
				format: "A4",
				pageCount: 1,
				elementCount: 0,
				collectionBindings: [],
			}),
		);
		render(
			<div data-testid="panel" className="overflow-hidden">
				<BulkActionBar
					model={{ selected: new Set(["Document 0"]), docList }}
					actions={{
						clear: vi.fn(),
						lock: vi.fn(),
						unlock: vi.fn(),
						recategorize: vi.fn(),
						delete: vi.fn(),
						export: vi.fn(),
					}}
				/>
			</div>,
		);

		await user.click(screen.getByRole("button", { name: "Move to category" }));
		const category = screen.getByRole("button", { name: "Account 29" });
		const menu = category.parentElement;
		expect(menu?.parentElement).toBe(document.body);
		expect(menu).toHaveClass("overflow-y-auto");
	});
});
