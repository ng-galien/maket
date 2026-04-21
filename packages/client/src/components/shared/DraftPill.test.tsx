import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DraftPill } from "./DraftPill";

afterEach(() => cleanup());

describe("DraftPill", () => {
	const url = "https://mail.google.com/mail/u/0/#drafts/MSG_42";

	it("renders the body label with the url on the anchor", () => {
		render(<DraftPill kind="body" url={url} />);
		const anchor = screen.getByRole("link");
		expect(anchor).toHaveAttribute("href", url);
		expect(anchor).toHaveAttribute("target", "_blank");
		expect(anchor).toHaveAttribute("rel", "noopener noreferrer");
		expect(anchor.textContent).toMatch(/Draft ready|Brouillon prêt/);
	});

	it("swaps the label for kind=attachment", () => {
		render(<DraftPill kind="attachment" url={url} />);
		const anchor = screen.getByRole("link");
		expect(anchor.textContent).toMatch(/In draft|Dans un brouillon/);
	});

	it("stops click propagation so the parent row doesn't steal focus", () => {
		let parentClicks = 0;
		render(
			<button type="button" onClick={() => parentClicks++}>
				<DraftPill kind="body" url={url} />
			</button>,
		);
		const anchor = screen.getByRole("link");
		anchor.addEventListener("click", (e) => e.preventDefault());
		anchor.click();
		expect(parentClicks).toBe(0);
	});
});
