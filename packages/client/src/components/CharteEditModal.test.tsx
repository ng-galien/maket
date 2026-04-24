import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CharteEditModal } from "./CharteEditModal";

const wsSendSpy = vi.fn();
vi.mock("../store/ws", () => ({
	wsSend: (msg: unknown) => wsSendSpy(msg),
}));

afterEach(() => {
	cleanup();
	wsSendSpy.mockClear();
});

describe("CharteEditModal", () => {
	it("preserves token groups, voice fields, and rule keys it doesn't model when saving", async () => {
		// Repro of the live-doc font regression: editing a color in aurora-2026
		// wiped `tokens.shadow` / any custom group + `voice.vocabulary` +
		// non-standard rule keys, because the modal only round-trips the subset
		// it knows about and the WS contract is a full replace. The payload
		// must include the original unknown fields so the server's saveCharte
		// doesn't erase them.
		const charte = {
			name: "aurora-2026",
			description: "northern lights",
			tokens: {
				color: { primary: "#112233" },
				font: { heading: "Inter" },
				spacing: { md: "8px" },
				radius: { md: "4px" },
				shadow: { sm: "0 1px 2px rgba(0,0,0,0.1)" },
				typography: {
					"body-size": "16px",
					"body-weight": "400",
				},
			},
			voice: {
				personality: ["bold"],
				formality: "casual",
				do: ["a"],
				dont: ["b"],
				vocabulary: ["aurora", "nordic"],
			},
			rules: {
				titles: "sentence case",
				photos: "cinematic",
				layout: "asymmetric",
				imagery: "no stock photos",
			},
		};

		render(<CharteEditModal charte={charte} onClose={() => {}} />);

		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /enregistrer/i }));

		expect(wsSendSpy).toHaveBeenCalledTimes(1);
		const payload = wsSendSpy.mock.calls[0][0] as {
			type: string;
			name: string;
			tokens?: Record<string, Record<string, string>>;
			voice?: { vocabulary?: string[] };
			rules?: Record<string, string>;
		};

		expect(payload.type).toBe("charte_save");
		expect(payload.name).toBe("aurora-2026");

		// Unknown token groups survive.
		expect(payload.tokens?.shadow).toEqual({
			sm: "0 1px 2px rgba(0,0,0,0.1)",
		});
		expect(payload.tokens?.typography).toEqual({
			"body-size": "16px",
			"body-weight": "400",
		});

		// Modeled groups still present.
		expect(payload.tokens?.color).toEqual({ primary: "#112233" });
		expect(payload.tokens?.font).toEqual({ heading: "Inter" });

		// Voice fields not surfaced in the modal survive.
		expect(payload.voice?.vocabulary).toEqual(["aurora", "nordic"]);

		// Rules keys outside titles/photos/layout survive.
		expect(payload.rules?.imagery).toBe("no stock photos");
	});

	it("keeps the unit when the user clears the number before retyping it", async () => {
		// Repro: a spacing row shows "8px". User wipes the "8" to type "10".
		// The intermediate value is just "px" (no digits). The current
		// parseLength regex requires at least one digit, so it falls back to a
		// plain text input, the unit select disappears, and the next keystroke
		// writes "10" with no unit — silently breaking spacing/radius tokens.
		const charte = {
			name: "spaced",
			tokens: { spacing: { gap: "8px" } },
		};
		render(<CharteEditModal charte={charte} onClose={() => {}} />);

		const numericInput = () =>
			screen
				.getAllByRole("textbox")
				.find((i) => (i as HTMLInputElement).inputMode === "decimal") as
				| HTMLInputElement
				| undefined;

		expect(numericInput()?.value).toBe("8");

		// Clear the number field — after this the length UI must stay intact.
		fireEvent.change(numericInput() as HTMLInputElement, {
			target: { value: "" },
		});
		expect(numericInput()).toBeDefined();

		fireEvent.change(numericInput() as HTMLInputElement, {
			target: { value: "10" },
		});

		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /enregistrer/i }));

		const payload = wsSendSpy.mock.calls[0]?.[0] as {
			tokens?: Record<string, Record<string, string>>;
		};
		expect(payload.tokens?.spacing?.gap).toBe("10px");
	});
});
